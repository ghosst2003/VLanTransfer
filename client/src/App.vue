<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useDevices } from './composables/useDevices'
import { useWebSocket } from './composables/useWebSocket'
import { useWebRTC } from './composables/useWebRTC'
import DeviceList from './components/DeviceList.vue'
import ChatPanel from './components/ChatPanel.vue'
import FileTransfer from './components/FileTransfer.vue'

const { generateDeviceId, getDeviceName } = useDevices()
const deviceId = generateDeviceId()
const deviceName = getDeviceName()

const { isConnected, devices, connect, sendSignal } = useWebSocket()
const { peers, messages, transfers, createPeer, handleSignal, sendMessage, sendFile } = useWebRTC(devices, sendSignal)

const selectedDeviceId = ref<string | null>(null)
const selectedDevice = computed(() => devices.value.find((d) => d.id === selectedDeviceId.value))
const selectedPeerStatus = computed(() => {
  if (!selectedDeviceId.value) return null
  const peer = peers.value.get(selectedDeviceId.value)
  return peer?.status ?? null
})

onMounted(() => {
  connect(deviceId, deviceName)

  // Listen for incoming signals
  window.addEventListener('signal', ((e: CustomEvent) => {
    const { payload } = e.detail
    if (payload?.from && payload?.data) {
      handleSignal(payload.from as string, payload.data as Record<string, unknown>)
    }
  }) as EventListener)
})

function handleSelectDevice(id: string) {
  console.log('[App] Selected device:', id)
  selectedDeviceId.value = id
  const device = devices.value.find((d) => d.id === id)
  if (device) {
    createPeer(device)
  } else {
    console.error('[App] Device not found:', id)
  }
}

function handleSendMessage(content: string) {
  if (!selectedDeviceId.value) return
  sendMessage(selectedDeviceId.value, content)
}

function handleSendFile(file: File) {
  if (!selectedDeviceId.value) return
  sendFile(selectedDeviceId.value, file)
}
</script>

<template>
  <header class="app-header">
    <h1>LAN Transfer</h1>
    <div class="device-badge">
      <span class="device-name">{{ deviceName }}</span>
      <span class="status-dot" :class="{ online: isConnected }"></span>
    </div>
  </header>

  <main class="app-main">
    <section class="devices-section">
      <h2>Devices ({{ devices.length }})</h2>
      <DeviceList
        :devices="devices"
        :current-id="deviceId"
        :selected-id="selectedDeviceId"
        :peers="peers"
        @select="handleSelectDevice"
      />
    </section>

    <section v-if="selectedDevice" class="chat-section">
      <div class="chat-header">
        <h2>{{ selectedDevice.name }}</h2>
        <span class="peer-status" :class="selectedPeerStatus">
          {{ selectedPeerStatus === 'connected' ? 'Connected' : selectedPeerStatus === 'connecting' ? 'Connecting...' : 'Disconnected' }}
        </span>
      </div>

      <ChatPanel
        :messages="messages.get(selectedDeviceId!) || []"
        :disabled="selectedPeerStatus !== 'connected'"
        @send="handleSendMessage"
      />

      <FileTransfer
        :transfers="transfers"
        :disabled="selectedPeerStatus !== 'connected'"
        @send-file="handleSendFile"
      />
    </section>
    <section v-else class="empty-section">
      <p class="empty-hint">点击左侧设备开始连接</p>
    </section>
  </main>
</template>

<style scoped>
.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 0;
  border-bottom: 1px solid var(--border);
  margin-bottom: 20px;
}

.app-header h1 {
  font-size: 24px;
  font-weight: 600;
}

.device-badge {
  display: flex;
  align-items: center;
  gap: 8px;
}

.device-name {
  font-size: 14px;
  color: var(--text-secondary);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--error);
}

.status-dot.online {
  background: var(--success);
}

.devices-section {
  margin-bottom: 20px;
}

.devices-section h2 {
  font-size: 18px;
  margin-bottom: 12px;
  font-weight: 600;
}

.chat-section {
  background: var(--surface);
  border-radius: var(--radius);
  border: 1px solid var(--border);
  overflow: hidden;
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.chat-header h2 {
  font-size: 16px;
  font-weight: 600;
}

.peer-status {
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 4px;
}

.peer-status.connected {
  background: #dcfce7;
  color: #166534;
}

.peer-status.connecting {
  background: #fef3c7;
  color: #92400e;
}

.peer-status.error,
.peer-status:not(.connected):not(.connecting) {
  background: #fee2e2;
  color: #991b1b;
}

@media (max-width: 600px) {
  #app {
    padding: 12px;
  }

  .app-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
}
</style>
