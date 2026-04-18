import { ref, onUnmounted, type Ref } from 'vue'
import type { Device, TransferState, SignalMessage } from '../types'

export interface PeerState {
  pc: RTCPeerConnection
  channel: RTCDataChannel | null
  device: Device
  status: 'connecting' | 'connected' | 'error'
  pendingCandidates: RTCIceCandidateInit[]
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

export function useWebRTC(
  devices: Ref<Device[]>,
  sendSignalFn: (to: string, data: Record<string, unknown>) => void,
) {
  const sendSignal = sendSignalFn
  const peers = ref<Map<string, PeerState>>(new Map())
  const messages = ref<Map<string, Array<{ content: string; from: string; timestamp: number }>>>(new Map())

  // File transfer state
  const fileBuffers = ref<Map<string, { chunks: ArrayBuffer[]; fileName: string; totalSize: number; totalChunks: number }>>(new Map())
  const transfers = ref<Map<string, TransferState>>(new Map())

  function createPeer(device: Device) {
    if (peers.value.has(device.id)) {
      console.log('[WebRTC] Peer already exists for', device.id)
      return
    }

    console.log('[WebRTC] Creating peer for', device.name, device.id)
    const pc = new RTCPeerConnection(RTC_CONFIG)
    const channel = pc.createDataChannel('data', { ordered: true })
    const state: PeerState = { pc, channel, device, status: 'connecting', pendingCandidates: [] }
    peers.value.set(device.id, state)
    console.log('[WebRTC] Peer created, status:', state.status)

    setupDataChannel(channel, device)
    setupPeerEvents(pc, device)

    // Set up negotiation manually (avoid double-firing with the native onnegotiationneeded)
    pc.createOffer({ iceRestart: false })
      .then(async (offer) => {
        console.log('[WebRTC] Offer created, setting local description')
        await pc.setLocalDescription(offer)
        console.log('[WebRTC] Local description set, waiting for ICE gathering')
        await waitForIceGathering(pc)
        const bundledSignal = {
          type: 'offer',
          sdp: pc.localDescription!.sdp,
          candidates: state.pendingCandidates,
        }
        console.log('[WebRTC] Sending offer with', state.pendingCandidates.length, 'ICE candidates')
        sendSignal(device.id, bundledSignal)
      })
      .catch((err) => {
        console.error('[WebRTC] Failed to create offer:', err)
        updatePeerStatus(device.id, 'error')
      })
  }

  async function handleSignal(fromId: string, data: Record<string, unknown>) {
    const device = devices.value.find((d) => d.id === fromId)
    if (!device) {
      console.log('[WebRTC] Received signal from unknown device', fromId)
      return
    }

    const signalData = data as { type: string; sdp: string; candidates: RTCIceCandidateInit[] }
    console.log('[WebRTC] handleSignal called, type:', signalData.type, 'from:', fromId)

    if (!peers.value.has(fromId)) {
      console.log('[WebRTC] Creating passive peer for', device.name)
      const peerConn = new RTCPeerConnection(RTC_CONFIG)
      const state: PeerState = { pc: peerConn, channel: null, device, status: 'connecting', pendingCandidates: [] }
      peers.value.set(fromId, state)

      peerConn.ondatachannel = (e) => {
        console.log('[WebRTC] Incoming data channel received')
        state.channel = e.channel
        setupDataChannel(e.channel, device)
      }
      setupPeerEvents(peerConn, device)
    }

    const state = peers.value.get(fromId)!
    const peerConn = state.pc

    if (signalData.type === 'offer') {
      state.pendingCandidates = signalData.candidates || []
      console.log('[WebRTC] Setting remote description (offer)')
      await peerConn.setRemoteDescription({ type: 'offer', sdp: signalData.sdp })

      for (const candidate of state.pendingCandidates) {
        try {
          await peerConn.addIceCandidate(candidate)
        } catch {
          // Ignore invalid candidates
        }
      }

      console.log('[WebRTC] Creating answer')
      const answer = await peerConn.createAnswer()
      await peerConn.setLocalDescription(answer)

      await waitForIceGathering(peerConn)
      const bundledSignal = {
        type: 'answer',
        sdp: peerConn.localDescription!.sdp,
        candidates: state.pendingCandidates,
      }
      console.log('[WebRTC] Sending answer with', state.pendingCandidates.length, 'ICE candidates')
      sendSignal(fromId, bundledSignal)
    } else if (signalData.type === 'answer') {
      console.log('[WebRTC] Setting remote description (answer)')
      await peerConn.setRemoteDescription({ type: 'answer', sdp: signalData.sdp })

      const candidates = signalData.candidates || []
      for (const candidate of candidates) {
        try {
          await peerConn.addIceCandidate(candidate)
        } catch {
          // Ignore invalid candidates
        }
      }
    }
  }

  function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') {
        resolve()
        return
      }

      const checkState = () => {
        if (pc.iceGatheringState === 'complete') {
          pc.removeEventListener('icegatheringstatechange', checkState)
          resolve()
        }
      }
      pc.addEventListener('icegatheringstatechange', checkState)

      // Timeout after 5 seconds
      setTimeout(() => {
        pc.removeEventListener('icegatheringstatechange', checkState)
        resolve()
      }, 5000)
    })
  }

  // Helper to update peer state reactively
  function updatePeerStatus(id: string, status: PeerState['status']) {
    const state = peers.value.get(id)
    if (state) {
      peers.value.set(id, { ...state, status })
    }
  }

  function setupDataChannel(channel: RTCDataChannel, device: Device) {
    channel.binaryType = 'arraybuffer'

    channel.onopen = () => {
      updatePeerStatus(device.id, 'connected')
      if (!messages.value.has(device.id)) {
        messages.value.set(device.id, [])
      }
    }

    channel.onmessage = (e) => {
      let data: Record<string, unknown>
      try {
        if (typeof e.data === 'string') {
          data = JSON.parse(e.data)
        } else if (e.data instanceof ArrayBuffer) {
          handleFileChunk(e.data)
          return
        } else {
          data = e.data as Record<string, unknown>
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
          status: 'receiving' as const,
        })
      } else if (data.msgType === 'file-chunk') {
        handleFileChunk(data)
      } else if (data.msgType === 'file-end') {
        handleFileComplete(data.fileId as string)
      }
    }

    channel.onclose = () => {
      updatePeerStatus(device.id, 'connecting')
    }

    channel.onerror = () => {
      console.error('[WebRTC] Data channel error')
      updatePeerStatus(device.id, 'error')
    }
  }

  function setupPeerEvents(pc: RTCPeerConnection, device: Device) {
    pc.onicecandidate = (e) => {
      const state = peers.value.get(device.id)
      if (state && e.candidate) {
        state.pendingCandidates.push(e.candidate.toJSON())
      }
    }

    pc.onconnectionstatechange = () => {
      if (!peers.value.has(device.id)) return
      if (pc.connectionState === 'connected') {
        updatePeerStatus(device.id, 'connected')
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        updatePeerStatus(device.id, 'error')
      }
    }
  }

  function sendMessage(deviceId: string, content: string) {
    const state = peers.value.get(deviceId)
    if (!state || state.status !== 'connected' || !state.channel) return

    const msg = { msgType: 'text', content, timestamp: Date.now() }
    state.channel.send(JSON.stringify(msg))

    const msgs = messages.value.get(deviceId) || []
    msgs.push({ content, from: 'me', timestamp: Date.now() })
    messages.value.set(deviceId, msgs)
  }

  function sendFile(deviceId: string, file: File) {
    const state = peers.value.get(deviceId)
    if (!state || state.status !== 'connected' || !state.channel) return

    const channelId = state.channel
    const fileId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const CHUNK_SIZE = 16 * 1024
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
    // Max buffered bytes before pausing (256KB)
    const BUFFER_THRESHOLD = 256 * 1024
    // How often to re-check bufferedAmount when full (10ms)
    const DRAIN_CHECK_MS = 10

    // Send file start
    channelId.send(JSON.stringify({
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
      status: 'sending' as const,
    })

    // Send chunks
    let offset = 0
    let chunkIndex = 0
    const reader = new FileReader()

    function waitForDrain(fn: () => void) {
      if (channelId.bufferedAmount <= BUFFER_THRESHOLD) {
        fn()
      } else {
        setTimeout(() => waitForDrain(fn), DRAIN_CHECK_MS)
      }
    }

    function readNextChunk() {
      if (offset >= file.size) {
        // Wait for buffer to drain before sending file-end
        waitForDrain(() => {
          channelId.send(JSON.stringify({
            msgType: 'file-end',
            fileId,
          }))
          const transfer = transfers.value.get(fileId)
          if (transfer) transfer.status = 'done'
        })
        return
      }

      const slice = file.slice(offset, offset + CHUNK_SIZE)
      reader.onload = () => {
        const buffer = reader.result as ArrayBuffer
        const base64 = arrayBufferToBase64(buffer)
        const msg = JSON.stringify({
          msgType: 'file-chunk',
          fileId,
          chunkIndex,
          totalChunks,
          data: base64,
        })
        // Wait for buffer to drain before sending next chunk
        waitForDrain(() => {
          if (channelId.readyState !== 'open') return
          channelId.send(msg)
          chunkIndex++
          offset += CHUNK_SIZE

          const transfer = transfers.value.get(fileId)
          if (transfer) {
            transfer.transferred = offset
            transfer.progress = Math.round((offset / file.size) * 100)
          }

          readNextChunk()
        })
      }
      reader.readAsArrayBuffer(slice)
    }

    readNextChunk()
  }

  function handleFileChunk(data: ArrayBuffer | Record<string, unknown>) {
    if (data instanceof ArrayBuffer) return
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
      state.channel?.close()
      state.pc.close()
    }
    peers.value.clear()
  })

  return { peers, messages, transfers, createPeer, handleSignal, sendMessage, sendFile }
}
