import { ref, onUnmounted, watch, type Ref } from 'vue'
import type { Device, TransferState } from '../types'

export interface PeerState {
  pc: RTCPeerConnection
  channel: RTCDataChannel | null
  device: Device
  status: 'connecting' | 'connected' | 'error'
  pendingCandidates: RTCIceCandidateInit[]
  hadConnection: boolean
  // True if this peer initiated the connection (called createPeer first).
  // Only the initiator should drive renegotiation — the responder must not
  // create new offers after answering, otherwise it triggers an infinite loop.
  isInitiator: boolean
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

export function useWebRTC(
  devices: Ref<Device[]>,
  sendSignalFn: (to: string, data: Record<string, unknown>) => void,
  localId = '',
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

  // Track per-peer renegotiation in-progress to prevent glare
  const renegotiating = new Set<string>()

  // Cooldown timers to prevent spurious renegotiation during initial connection setup
  const renegotiationCooldowns = new Map<string, ReturnType<typeof setTimeout>>()

  // Non-reactive channel store to avoid Vue reactivity issues
  const channels = new Map<string, RTCDataChannel>()

  function getOrCreatePeer(device: Device): PeerState {
    const existing = peers.value.get(device.id)
    if (existing) return existing

    const pc = new RTCPeerConnection(RTC_CONFIG)
    // Determine initiator by device ID: lower ID initiates to avoid race.
    const isInitiator = localId !== '' ? device.id < localId : true
    const state: PeerState = {
      pc, channel: null, device, status: 'connecting',
      pendingCandidates: [], hadConnection: false, isInitiator,
    }
    peers.value.set(device.id, state)

    // Set up handlers BEFORE creating data channel
    setupPeerEvents(pc, device)

    // Set up listener for incoming data channel
    pc.ondatachannel = (e) => {
      console.log('[WebRTC] Incoming data channel for', device.id)
      const old = channels.get(device.id)
      if (old && old.readyState !== 'closed') old.close()
      channels.set(device.id, e.channel)
      state.channel = e.channel
      setupDataChannel(e.channel, device)
    }

    // Only the initiator creates the data channel and sends the offer.
    if (isInitiator) {
      const channel = pc.createDataChannel('data', { ordered: true })
      channels.set(device.id, channel)
      state.channel = channel
      setupDataChannel(channel, device)
    }

    return state
  }

  async function handleSignal(fromId: string, data: Record<string, unknown>) {
    const device = devices.value.find((d) => d.id === fromId)
    if (!device) {
      console.log('[WebRTC] Received signal from unknown device', fromId)
      return
    }

    const signalData = data as { type: string; sdp: string; candidates: RTCIceCandidateInit[] }
    console.log('[WebRTC] handleSignal type:', signalData.type, 'from:', fromId)

    // Use the shared peer state — getOrCreatePeer returns existing if present.
    // Both getOrCreatePeer and handleSignal use the same isInitiator logic,
    // so they agree on whether this peer is active (initiator) or passive.
    const state = getOrCreatePeer(device)
    const peerConn = state.pc

    if (signalData.type === 'offer') {
      // Handle glare: if we already have a local offer, rollback and accept remote
      if (peerConn.signalingState === 'have-local-offer') {
        console.log('[WebRTC] Glare detected, rolling back local offer')
        await peerConn.setLocalDescription({ type: 'rollback' })
        // Rollback destroys the local data channel. Clear the reference so
        // ondatachannel can set the remote's channel instead.
        channels.delete(fromId)
        state.channel = null
      }

      // Do NOT create a data channel here. The remote's offer includes their
      // data channel, which will arrive via ondatachannel.

      const remoteCandidates = signalData.candidates || []
      console.log('[WebRTC] Setting remote description (offer) with', remoteCandidates.length, 'candidates')
      try {
        await peerConn.setRemoteDescription({ type: 'offer', sdp: signalData.sdp })
      } catch (err) {
        console.log('[WebRTC] Failed to set remote offer, signaling state:', peerConn.signalingState, err)
        return
      }

      // Clear stale candidates, then add the ones bundled in this offer
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

      // Set cooldown to prevent spurious renegotiation after initial negotiation
      renegotiationCooldowns.set(fromId, setTimeout(() => renegotiationCooldowns.delete(fromId), 10000))
    } else if (signalData.type === 'answer') {
      // Ignore stale answers when not in have-local-offer state.
      // This happens when there are other browser tabs connected to the
      // same signaling server sending stale messages.
      if (peerConn.signalingState !== 'have-local-offer') {
        console.log('[WebRTC] Ignoring answer — signaling state:', peerConn.signalingState)
        return
      }
      console.log('[WebRTC] Setting remote description (answer)')
      try {
        await peerConn.setRemoteDescription({ type: 'answer', sdp: signalData.sdp })
      } catch (err) {
        console.log('[WebRTC] Failed to set remote answer:', err)
        return
      }

      const candidates = signalData.candidates || []
      for (const candidate of candidates) {
        try {
          await peerConn.addIceCandidate(candidate)
        } catch {
          // Ignore invalid candidates
        }
      }
      state.pendingCandidates = []

      // Set cooldown to prevent spurious renegotiation after initial negotiation
      renegotiationCooldowns.set(fromId, setTimeout(() => renegotiationCooldowns.delete(fromId), 10000))
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

      setTimeout(() => {
        pc.removeEventListener('icegatheringstatechange', checkState)
        resolve()
      }, 5000)
    })
  }

  function updatePeerStatus(id: string, status: PeerState['status']) {
    const state = peers.value.get(id)
    if (state) {
      peers.value.set(id, { ...state, status })
    }
  }

  function setupDataChannel(channel: RTCDataChannel, device: Device) {
    channel.binaryType = 'arraybuffer'

    channel.onopen = () => {
      console.log('[WebRTC] Data channel OPEN for', device.id, 'negotiated:', channel.negotiated, 'id:', channel.id)
      updatePeerStatus(device.id, 'connected')
      if (!messages.value.has(device.id)) {
        messages.value.set(device.id, [])
      }
    }

    channel.onmessage = (e) => {
      console.log('[WebRTC] Message received from', device.id, 'type:', e.data instanceof ArrayBuffer ? 'binary' : 'text')
      if (e.data instanceof ArrayBuffer) {
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

      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(e.data)
      } catch {
        return
      }

      if (msg.msgType === 'text') {
        const msgs = messages.value.get(device.id) || []
        msgs.push({ content: msg.content as string, from: device.id, timestamp: msg.timestamp as number })
        messages.value.set(device.id, msgs)
      } else if (msg.msgType === 'file-start') {
        currentReceiveFileId = msg.fileId as string
        currentReceiveFile = {
          chunks: [],
          fileName: msg.fileName as string,
          totalSize: msg.totalSize as number,
        }
        transfers.value.set(msg.fileId as string, {
          fileName: msg.fileName as string,
          totalSize: msg.totalSize as number,
          transferred: 0,
          progress: 0,
          status: 'receiving',
          direction: 'in',
        })
      } else if (msg.msgType === 'file-end') {
        handleFileComplete(msg.fileId as string)
      }
    }

    channel.onclose = () => {
      channels.delete(device.id)
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

  function setupPeerEvents(pc: RTCPeerConnection, device: Device) {
    pc.onicecandidate = (e) => {
      const state = peers.value.get(device.id)
      if (state && e.candidate) {
        state.pendingCandidates.push(e.candidate.toJSON())
      }
    }

    pc.onnegotiationneeded = async () => {
      console.log('[WebRTC] onnegotiationneeded fired for', device.id, 'state:', pc.signalingState)
      // Block during active renegotiation
      if (renegotiating.has(device.id)) {
        console.log('[WebRTC] Skipping — already renegotiating')
        return
      }
      // Block when signaling is not stable
      if (pc.signalingState !== 'stable') {
        console.log('[WebRTC] Skipping — signaling state:', pc.signalingState)
        return
      }
      // Block during cooldown (prevents spurious renegotiation after initial setup)
      if (renegotiationCooldowns.has(device.id)) {
        console.log('[WebRTC] Skipping renegotiation — in cooldown')
        return
      }

      const state = peers.value.get(device.id)
      if (!state) return

      // The responder (passive peer) must NEVER drive renegotiation.
      // After answering the initial offer, renegotiation on the responder
      // side creates new offers that trigger an infinite answer/offer loop,
      // breaking the data channel.
      if (!state.isInitiator) {
        console.log('[WebRTC] Skipping renegotiation on responder peer')
        return
      }

      // Block while sending a file to avoid disrupting the data channel
      const hasActiveSend = [...transfers.value.values()].some(
        (t) => t.status === 'sending' && t.direction === 'out',
      )
      if (hasActiveSend) {
        console.log('[WebRTC] Skipping renegotiation — file transfer in progress')
        return
      }

      renegotiating.add(device.id)
      state.pendingCandidates = []
      console.log('[WebRTC] Renegotiation needed for', device.id)
      try {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        await waitForIceGathering(pc)
        sendSignal(device.id, {
          type: 'offer',
          sdp: pc.localDescription!.sdp,
          candidates: state.pendingCandidates,
        })
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
    const channel = channels.get(deviceId)
    console.log('[WebRTC] sendMessage to', deviceId,
      'peerExists:', !!state,
      'channel:', !!channel,
      'readyState:', channel?.readyState,
      'status:', state?.status)
    if (!state || state.status !== 'connected' || !channel || channel.readyState !== 'open') return

    const msg = { msgType: 'text', content, timestamp: Date.now() }
    channel.send(JSON.stringify(msg))

    const msgs = messages.value.get(deviceId) || []
    msgs.push({ content, from: 'me', timestamp: Date.now() })
    messages.value.set(deviceId, msgs)
  }

  function sendFile(deviceId: string, file: File) {
    const state = peers.value.get(deviceId)
    const channel = channels.get(deviceId)
    console.log('[WebRTC] sendFile to', deviceId, 'channel:', !!channel, 'readyState:', channel?.readyState, 'status:', state?.status)
    if (!state) return

    if (channel && channel.readyState === 'open') {
      _doSendFile(deviceId, file)
      return
    }

    // Recreate channel if needed
    let recreatePromise = channelRecreating.get(deviceId)
    if (!recreatePromise) {
      recreatePromise = (async () => {
        try {
          const newChannel = state.pc.createDataChannel('data', { ordered: true })
          channels.set(deviceId, newChannel)
          setupDataChannel(newChannel, state.device)
          return new Promise<boolean>((resolve) => {
            const timeout = setTimeout(() => {
              newChannel.removeEventListener('open', onOpen)
              resolve(false)
            }, 10000)
            const onOpen = () => {
              clearTimeout(timeout)
              resolve(true)
            }
            newChannel.addEventListener('open', onOpen)
          })
        } catch {
          return false
        } finally {
          channelRecreating.delete(deviceId)
        }
      })()
      channelRecreating.set(deviceId, recreatePromise)
    }

    recreatePromise.then((ok) => {
      if (!ok) return
      const freshChannel = channels.get(deviceId)
      if (freshChannel?.readyState === 'open') {
        _doSendFile(deviceId, file)
      }
    })
  }

  function _doSendFile(deviceId: string, file: File) {
    const channel = channels.get(deviceId)
    if (!channel || channel.readyState !== 'open') return
    const fileId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const CHUNK_SIZE = 16 * 1024
    const BUFFER_THRESHOLD = 256 * 1024
    const DRAIN_CHECK_MS = 10

    channel.send(JSON.stringify({
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
      status: 'sending',
      direction: 'out',
    })

    let offset = 0

    function waitForDrain(fn: () => void) {
      if (channel.readyState !== 'open') return
      if (channel.bufferedAmount <= BUFFER_THRESHOLD) {
        fn()
      } else {
        setTimeout(() => waitForDrain(fn), DRAIN_CHECK_MS)
      }
    }

    function sendNextChunk() {
      if (offset >= file.size) {
        waitForDrain(() => {
          if (channel.readyState === 'open') {
            channel.send(JSON.stringify({ msgType: 'file-end', fileId }))
          }
          const transfer = transfers.value.get(fileId)
          if (transfer) transfer.status = 'done'
        })
        return
      }

      const slice = file.slice(offset, offset + CHUNK_SIZE)
      slice.arrayBuffer().then((buffer) => {
        if (channel.readyState !== 'open') return
        channel.send(buffer)
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

    currentReceiveFile = null
    currentReceiveFileId = null
  }

  function removePeer(deviceId: string) {
    const state = peers.value.get(deviceId)
    if (!state) return
    const ch = channels.get(deviceId)
    ch?.close()
    state.pc.close()
    peers.value.delete(deviceId)
    channels.delete(deviceId)
    channelRecreating.delete(deviceId)
    renegotiating.delete(deviceId)
    messages.value.delete(deviceId)
  }

  watch(
    devices,
    (currentDevices) => {
      const knownIds = new Set(currentDevices.map((d) => d.id))
      for (const peerId of peers.value.keys()) {
        if (!knownIds.has(peerId)) {
          console.log('[WebRTC] Peer device left, cleaning up:', peerId)
          removePeer(peerId)
        }
      }
    },
    { deep: true },
  )

  onUnmounted(() => {
    for (const ch of channels.values()) ch.close()
    for (const state of peers.value.values()) state.pc.close()
    peers.value.clear()
    channels.clear()
    channelRecreating.clear()
    renegotiating.clear()
  })

  return { peers, messages, transfers, createPeer: getOrCreatePeer, handleSignal, sendMessage, sendFile, removePeer }
}
