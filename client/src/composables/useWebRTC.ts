import { ref, onUnmounted } from 'vue'
import Peer from 'simple-peer'
import type { Device } from '../types'
import { useWebSocket } from './useWebSocket'

export interface PeerState {
  peer: InstanceType<typeof Peer>
  device: Device
  status: 'connecting' | 'connected' | 'error'
}

export function useWebRTC() {
  const { devices, sendSignal } = useWebSocket()
  const peers = ref<Map<string, PeerState>>(new Map())
  const messages = ref<Map<string, Array<{ content: string; from: string; timestamp: number }>>>(new Map())

  // File transfer state
  const fileBuffers = ref<Map<string, { chunks: ArrayBuffer[]; fileName: string; totalSize: number; totalChunks: number }>>(new Map())
  const transfers = ref<Map<string, { fileName: string; totalSize: number; transferred: number; progress: number; status: string }>>(new Map())

  function createPeer(device: Device) {
    if (peers.value.has(device.id)) return

    const peer = new Peer({ initiator: true, trickle: false })
    const state: PeerState = { peer, device, status: 'connecting' }
    peers.value.set(device.id, state)

    setupPeerEvents(peer, device)
  }

  function handleSignal(fromId: string, data: Record<string, unknown>) {
    const device = devices.value.find((d) => d.id === fromId)
    if (!device) return

    if (!peers.value.has(fromId)) {
      const peer = new Peer({ initiator: false, trickle: false })
      const state: PeerState = { peer, device, status: 'connecting' }
      peers.value.set(fromId, state)
      setupPeerEvents(peer, device)
    }

    const state = peers.value.get(fromId)!
    if (data.type === 'offer') {
      state.peer.signal(data)
    } else if (data.type === 'answer') {
      state.peer.signal(data)
    } else if (data.type === 'candidate') {
      // simple-peer handles ICE internally with trickle: false
    }
  }

  function setupPeerEvents(peer: InstanceType<typeof Peer>, device: Device) {
    peer.on('signal', (data) => {
      sendSignal(device.id, data)
    })

    peer.on('connect', () => {
      const state = peers.value.get(device.id)
      if (state) state.status = 'connected'
      if (!messages.value.has(device.id)) {
        messages.value.set(device.id, [])
      }
    })

    peer.on('data', (rawData: unknown) => {
      let data: Record<string, unknown>
      try {
        if (typeof rawData === 'string') {
          data = JSON.parse(rawData)
        } else if (rawData instanceof ArrayBuffer || rawData instanceof Uint8Array) {
          handleFileChunk(rawData)
          return
        } else {
          data = rawData as Record<string, unknown>
        }
      } catch {
        return
      }

      if (data.msgType === 'text') {
        const msgs = messages.value.get(device.id) || []
        msgs.push({ content: data.content as string, from: device.id, timestamp: data.timestamp as number })
        messages.value.set(device.id, msgs)
      } else if (data.msgType === 'file-start') {
        fileBuffers.value.set(data.fileId as string, {
          chunks: [],
          fileName: data.fileName as string,
          totalSize: data.totalSize as number,
          totalChunks: data.totalChunks as number,
        })
        transfers.value.set(data.fileId as string, {
          fileName: data.fileName as string,
          totalSize: data.totalSize as number,
          transferred: 0,
          progress: 0,
          status: 'receiving',
        })
      } else if (data.msgType === 'file-chunk') {
        handleFileChunk(data)
      } else if (data.msgType === 'file-end') {
        handleFileComplete(data.fileId as string)
      }
    })

    peer.on('error', (err) => {
      console.error('Peer error:', err)
      const state = peers.value.get(device.id)
      if (state) state.status = 'error'
    })

    peer.on('close', () => {
      const state = peers.value.get(device.id)
      if (state) state.status = 'connecting'
    })
  }

  function sendMessage(deviceId: string, content: string) {
    const state = peers.value.get(deviceId)
    if (!state || state.status !== 'connected') return

    const msg = { msgType: 'text', content, timestamp: Date.now() }
    state.peer.send(JSON.stringify(msg))

    const msgs = messages.value.get(deviceId) || []
    msgs.push({ content, from: 'me', timestamp: Date.now() })
    messages.value.set(deviceId, msgs)
  }

  function sendFile(deviceId: string, file: File) {
    const state = peers.value.get(deviceId)
    if (!state || state.status !== 'connected') return

    const fileId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const CHUNK_SIZE = 16 * 1024
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)

    // Send file start
    state.peer.send(JSON.stringify({
      msgType: 'file-start',
      fileId,
      fileName: file.name,
      totalSize: file.size,
      totalChunks,
    }))

    transfers.value.set(fileId, {
      fileName: file.name,
      totalSize: file.size,
      transferred: 0,
      progress: 0,
      status: 'sending',
    })

    // Send chunks
    let offset = 0
    let chunkIndex = 0
    const reader = new FileReader()

    function readNextChunk() {
      if (offset >= file.size) {
        // All chunks sent
        state.peer.send(JSON.stringify({
          msgType: 'file-end',
          fileId,
        }))
        const transfer = transfers.value.get(fileId)
        if (transfer) transfer.status = 'done'
        return
      }

      const slice = file.slice(offset, offset + CHUNK_SIZE)
      reader.onload = () => {
        const buffer = reader.result as ArrayBuffer
        // Convert to JSON-wrapped base64 for datachannel
        const base64 = arrayBufferToBase64(buffer)
        state.peer.send(JSON.stringify({
          msgType: 'file-chunk',
          fileId,
          chunkIndex,
          totalChunks,
          data: base64,
        }))
        chunkIndex++
        offset += CHUNK_SIZE

        const transfer = transfers.value.get(fileId)
        if (transfer) {
          transfer.transferred = offset
          transfer.progress = Math.round((offset / file.size) * 100)
        }

        readNextChunk()
      }
      reader.readAsArrayBuffer(slice)
    }

    readNextChunk()
  }

  function handleFileChunk(data: Record<string, unknown>) {
    if (typeof data === 'string') return
    const fileId = data.fileId as string
    const buffer = base64ToArrayBuffer(data.data as string)
    const fileBuf = fileBuffers.value.get(fileId)
    if (!fileBuf) return

    fileBuf.chunks[data.chunkIndex as number] = buffer
    const transfer = transfers.value.get(fileId)
    if (transfer) {
      transfer.transferred = fileBuf.chunks.reduce((sum, c) => sum + (c?.byteLength || 0), 0)
      transfer.progress = Math.round((transfer.transferred / transfer.totalSize) * 100)
    }
  }

  function handleFileComplete(fileId: string) {
    const fileBuf = fileBuffers.value.get(fileId)
    if (!fileBuf) return

    // Reassemble file
    const blob = new Blob(fileBuf.chunks)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileBuf.fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    const transfer = transfers.value.get(fileId)
    if (transfer) transfer.status = 'done'
    fileBuffers.value.delete(fileId)
  }

  function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }

  function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes.buffer
  }

  onUnmounted(() => {
    for (const state of peers.value.values()) {
      state.peer.destroy()
    }
    peers.value.clear()
  })

  return { peers, messages, transfers, createPeer, handleSignal, sendMessage, sendFile }
}
