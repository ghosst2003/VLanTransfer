import { ref, onUnmounted } from 'vue'
import type { Device, SignalMessage } from '../types'

const wsUrl = import.meta.env.DEV
  ? `ws://${window.location.host.replace(/:\d+$/, ':3001')}`
  : window.location.protocol === 'https:'
    ? `wss://${window.location.host}`
    : `ws://${window.location.host}`

export function useWebSocket() {
  const ws = ref<WebSocket | null>(null)
  const isConnected = ref(false)
  const devices = ref<Device[]>([])

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null

  function connect(deviceId: string, deviceName: string) {
    ws.value = new WebSocket(wsUrl)

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
      // Reconnect after 3s
      setTimeout(() => connect(deviceId, deviceName), 3000)
    }

    ws.value.onerror = () => {
      ws.value?.close()
    }
  }

  function handleMessage(msg: SignalMessage) {
    switch (msg.type) {
      case 'device-list':
        devices.value = msg.payload as Device[]
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
        payload: { from: (window as any).__deviceId, to, data },
      }))
    }
  }

  function disconnect() {
    if (ws.value) {
      ws.value.send(JSON.stringify({
        type: 'leave',
        payload: { id: (window as any).__deviceId },
      }))
      ws.value.close()
    }
    if (heartbeatTimer) clearInterval(heartbeatTimer)
  }

  onUnmounted(disconnect)

  return { ws, isConnected, devices, connect, sendSignal, disconnect }
}
