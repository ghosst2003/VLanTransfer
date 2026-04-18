import { ref, onUnmounted, type Ref } from 'vue'
import type { Device, TransferState } from '../types'

export interface PeerState {
  pc: RTCPeerConnection
  channel: RTCDataChannel | null
  device: Device
  status: 'connecting' | 'connected' | 'error'
  pendingCandidates: RTCIceCandidateInit[]
  hadConnection: boolean
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
  const transfers = ref<Map<string, TransferState>>(new Map())

  // Shared state for active file receive
  let currentReceiveFile: { chunks: ArrayBuffer[]; fileName: string; totalSize: number } | null = null
  let currentReceiveFileId: string | null = null

  // Track per-peer channel recreation promises
  const channelRecreating = new Map<string, Promise<boolean>>()

  function createPeer(device: Device) {
    if (peers.value.has(device.id)) {
      console.log('[WebRTC] Peer already exists for', device.id)
      return
    }

    const pc = new RTCPeerConnection(RTC_CONFIG)
    const state: PeerState = { pc, channel: null, device, status: 'connecting', pendingCandidates: [], hadConnection: false }
    peers.value.set(device.id, state)

    // Set up handlers BEFORE createDataChannel so onnegotiationneeded is caught
    setupPeerEvents(pc, device)

    const channel = pc.createDataChannel('data', { ordered: true })
    state.channel = channel
    setupDataChannel(channel, device)
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
      const state: PeerState = { pc: peerConn, channel: null, device, status: 'connecting', pendingCandidates: [], hadConnection: false }
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
      // Handle glare: if we already have a local offer, rollback and accept remote
      if (peerConn.signalingState === 'have-local-offer') {
        console.log('[WebRTC] Glare detected, rolling back local offer')
        await peerConn.setLocalDescription({ type: 'rollback' })
      }
      const remoteCandidates = signalData.candidates || []
      console.log('[WebRTC] Setting remote description (offer) with', remoteCandidates.length, 'candidates')
      await peerConn.setRemoteDescription({ type: 'offer', sdp: signalData.sdp })

      // Clear stale candidates, then add the ones from this offer
      state.pendingCandidates = []
      for (const candidate of remoteCandidates) {
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
      // Clear candidates after negotiation is done
      state.pendingCandidates = []
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
      if (e.data instanceof ArrayBuffer) {
        // Binary file chunk
        if (currentReceiveFile && currentReceiveFileId) {
          currentReceiveFile.chunks.push(e.data)
          const transferred = currentReceiveFile.chunks.reduce((sum, c) => sum + c.byteLength, 0)
          const transfer = transfers.value.get(currentReceiveFileId)
          if (transfer) {
            transfer.transferred = transferred
            transfer.progress = Math.round((transferred / transfer.totalSize) * 100)
          }
        }
        return
      }

      let data: Record<string, unknown>
      try {
        data = JSON.parse(e.data)
      } catch {
        return
      }

      if (data.msgType === 'text') {
        const msgs = messages.value.get(device.id) || []
        msgs.push({ content: data.content as string, from: device.id, timestamp: data.timestamp as number })
        messages.value.set(device.id, msgs)
      } else if (data.msgType === 'file-start') {
        currentReceiveFileId = data.fileId as string
        currentReceiveFile = {
          chunks: [],
          fileName: data.fileName as string,
          totalSize: data.totalSize as number,
        }
        transfers.value.set(data.fileId as string, {
          fileName: data.fileName as string,
          totalSize: data.totalSize as number,
          transferred: 0,
          progress: 0,
          status: 'receiving' as const,
          direction: 'in' as const,
        })
      } else if (data.msgType === 'file-end') {
        handleFileComplete(data.fileId as string)
      }
    }

    channel.onclose = () => {
      const s = peers.value.get(device.id)
      if (s) {
        s.channel = null
        updatePeerStatus(device.id, 'connecting')
      }
      console.log('[WebRTC] Data channel closed for', device.id)
    }

    channel.onerror = () => {
      console.error('[WebRTC] Data channel error')
      updatePeerStatus(device.id, 'error')
    }
  }

  // Track per-peer renegotiation in-progress to prevent glare
  const renegotiating = new Set<string>()

  function setupPeerEvents(pc: RTCPeerConnection, device: Device) {
    pc.onicecandidate = (e) => {
      const state = peers.value.get(device.id)
      if (state && e.candidate) {
        state.pendingCandidates.push(e.candidate.toJSON())
      }
    }

    pc.onnegotiationneeded = async () => {
      if (pc.signalingState !== 'stable') return
      if (renegotiating.has(device.id)) return
      const state = peers.value.get(device.id)
      if (!state) return

      renegotiating.add(device.id)
      // Clear stale candidates from previous negotiations
      state.pendingCandidates = []
      console.log('[WebRTC] Renegotiation needed for', device.id)
      try {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        await waitForIceGathering(pc)
        const bundledSignal = {
          type: 'offer',
          sdp: pc.localDescription!.sdp,
          candidates: state.pendingCandidates,
        }
        console.log('[WebRTC] Sending renegotiation offer with', state.pendingCandidates.length, 'ICE candidates')
        sendSignal(device.id, bundledSignal)
        state.pendingCandidates = []
      } catch (err) {
        console.error('[WebRTC] Renegotiation failed:', err)
        updatePeerStatus(device.id, 'error')
      } finally {
        renegotiating.delete(device.id)
      }
    }

    pc.onconnectionstatechange = () => {
      if (!peers.value.has(device.id)) return
      const state = peers.value.get(device.id)!
      if (pc.connectionState === 'connected') {
        state.hadConnection = true
        updatePeerStatus(device.id, 'connected')
      } else if (pc.connectionState === 'failed') {
        updatePeerStatus(device.id, 'error')
      } else if (pc.connectionState === 'disconnected' && state.hadConnection) {
        updatePeerStatus(device.id, 'connecting')
      }
    }
  }

  function sendMessage(deviceId: string, content: string) {
    const state = peers.value.get(deviceId)
    if (!state || state.status !== 'connected' || !state.channel || state.channel.readyState !== 'open') return

    const msg = { msgType: 'text', content, timestamp: Date.now() }
    state.channel.send(JSON.stringify(msg))

    const msgs = messages.value.get(deviceId) || []
    msgs.push({ content, from: 'me', timestamp: Date.now() })
    messages.value.set(deviceId, msgs)
  }

  function sendFile(deviceId: string, file: File) {
    const state = peers.value.get(deviceId)
    if (!state) return

    // If channel is open, send directly
    if (state.channel && state.channel.readyState === 'open') {
      _doSendFile(deviceId, file)
      return
    }

    // If already recreating, wait for it then send
    let recreatePromise = channelRecreating.get(deviceId)
    if (!recreatePromise) {
      // Start recreation
      recreatePromise = (async () => {
        try {
          state.channel = state.pc.createDataChannel('data', { ordered: true })
          setupDataChannel(state.channel, state.device)
          // Wait for channel to open (up to 10s)
          return new Promise<boolean>((resolve) => {
            const timeout = setTimeout(() => {
              state.channel?.removeEventListener('open', onOpen)
              resolve(false)
            }, 10000)
            const onOpen = () => {
              clearTimeout(timeout)
              resolve(true)
            }
            state.channel!.addEventListener('open', onOpen)
          })
        } catch {
          return false
        } finally {
          channelRecreating.delete(deviceId)
        }
      })()
      channelRecreating.set(deviceId, recreatePromise)
    }

    // Wait for channel then send
    recreatePromise.then((ok) => {
      if (!ok) return
      const freshState = peers.value.get(deviceId)
      if (freshState?.channel?.readyState === 'open') {
        _doSendFile(deviceId, file)
      }
    })
  }

  function _doSendFile(deviceId: string, file: File) {
    const state = peers.value.get(deviceId)
    if (!state || !state.channel || state.channel.readyState !== 'open') return

    const channelId = state.channel
    const fileId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const CHUNK_SIZE = 16 * 1024
    const BUFFER_THRESHOLD = 256 * 1024
    const DRAIN_CHECK_MS = 10

    // Send file start as JSON
    channelId.send(JSON.stringify({
      msgType: 'file-start',
      fileId,
      fileName: file.name,
      totalSize: file.size,
      totalChunks: Math.ceil(file.size / CHUNK_SIZE),
    }))

    transfers.value.set(fileId, {
      fileName: file.name,
      totalSize: file.size,
      transferred: 0,
      progress: 0,
      status: 'sending' as const,
      direction: 'out' as const,
    })

    let offset = 0

    function waitForDrain(fn: () => void) {
      if (channelId.readyState !== 'open') return
      if (channelId.bufferedAmount <= BUFFER_THRESHOLD) {
        fn()
      } else {
        setTimeout(() => waitForDrain(fn), DRAIN_CHECK_MS)
      }
    }

    function sendNextChunk() {
      if (offset >= file.size) {
        waitForDrain(() => {
          if (channelId.readyState === 'open') {
            channelId.send(JSON.stringify({
              msgType: 'file-end',
              fileId,
            }))
          }
          const transfer = transfers.value.get(fileId)
          if (transfer) transfer.status = 'done'
        })
        return
      }

      const slice = file.slice(offset, offset + CHUNK_SIZE)
      slice.arrayBuffer().then((buffer) => {
        if (channelId.readyState !== 'open') return
        // Send binary chunk directly (no base64 overhead)
        channelId.send(buffer)
        offset += CHUNK_SIZE

        const transfer = transfers.value.get(fileId)
        if (transfer) {
          transfer.transferred = offset
          transfer.progress = Math.round((offset / file.size) * 100)
        }

        waitForDrain(sendNextChunk)
      })
    }

    waitForDrain(sendNextChunk)
  }

  function handleFileComplete(fileId: string) {
    const fileBuf = currentReceiveFile
    if (!fileBuf || fileId !== currentReceiveFileId) return

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

    // Reset receive state
    currentReceiveFile = null
    currentReceiveFileId = null
  }

  onUnmounted(() => {
    for (const state of peers.value.values()) {
      state.channel?.close()
      state.pc.close()
    }
    peers.value.clear()
    channelRecreating.clear()
    renegotiating.clear()
  })

  return { peers, messages, transfers, createPeer, handleSignal, sendMessage, sendFile }
}
