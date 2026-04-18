import { ref } from 'vue'
import type { Device, SignalMessage } from '../types'

const signalingUrl = (window as any).__SIGNALING_URL__
  || (import.meta.env.VITE_SIGNALING_URL
    ? import.meta.env.VITE_SIGNALING_URL
    : import.meta.env.DEV
      ? `ws://${window.location.host.replace(/:\d+$/, ':3001')}`
      : import.meta.env.PROD
        ? `wss://${window.location.host}`
        : `ws://${window.location.host}`)

// Shared state - all callers use the same WebSocket
const ws = ref<WebSocket | null>(null)
const isConnected = ref(false)
const devices = ref<Device[]>([])
let localDeviceId = ''
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

export function useWebSocket() {
  function connect(deviceId: string, deviceName: string) {
    localDeviceId = deviceId
    ws.value = new WebSocket(signalingUrl)

    ws.value.onopen = () => {
      isConnected.value = true
      ws.value!.send(JSON.stringify({
        type: 'join',
        payload: { id: deviceId, name: deviceName },
      }))
      heartbeatTimer = setInterval(() => {
        if (ws.value?.readyState === WebSocket.OPEN) {
          ws.value.send(JSON.stringify({ type: 'ping' }))
        }
      }, 25000)
    }

    ws.value.onmessage = (event) => {
      const msg: SignalMessage = JSON.parse(event.data)
      handleMessage(msg)
    }

    ws.value.onclose = () => {
      isConnected.value = false
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      setTimeout(() => connect(deviceId, deviceName), 3000)
    }

    ws.value.onerror = () => {
      ws.value?.close()
    }
  }

  function handleMessage(msg: SignalMessage) {
    switch (msg.type) {
      case 'device-list':
        devices.value = msg.payload as unknown as Device[]
        break
      case 'pong':
      case 'ping':
        break
      default:
        window.dispatchEvent(new CustomEvent('signal', { detail: msg }))
        break
    }
  }

  function sendSignal(to: string, data: Record<string, unknown>) {
    if (ws.value?.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify({
        type: 'signal',
        payload: { from: localDeviceId, to, data },
      }))
    }
  }

  function disconnect() {
    if (ws.value) {
      ws.value.send(JSON.stringify({
        type: 'leave',
        payload: { id: localDeviceId },
      }))
      ws.value.close()
    }
    if (heartbeatTimer) clearInterval(heartbeatTimer)
  }

  return { ws, isConnected, devices, connect, sendSignal, disconnect }
}
