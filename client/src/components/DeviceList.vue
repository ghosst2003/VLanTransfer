<script setup lang="ts">
import type { Device } from '../types'
import type { PeerState } from '../composables/useWebRTC'

defineProps<{
  devices: Device[]
  currentId: string
  selectedId: string | null
  peers: Map<string, PeerState>
}>()

const emit = defineEmits<{
  select: [deviceId: string]
}>()
</script>

<template>
  <div class="device-list">
    <div
      v-for="device in devices.filter((d) => d.id !== currentId)"
      :key="device.id"
      class="device-item"
      :class="{ active: selectedId === device.id }"
      @click="emit('select', device.id)"
    >
      <div class="device-icon">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      </div>
      <div class="device-info">
        <span class="device-name">{{ device.name }}</span>
        <span class="device-status" :class="peers.get(device.id)?.status">
          {{ peers.get(device.id)?.status === 'connected' ? '已连接' : peers.get(device.id)?.status === 'connecting' ? '连接中' : '点击连接' }}
        </span>
      </div>
    </div>
    <div v-if="devices.filter((d) => d.id !== currentId).length === 0" class="empty-state">
      等待其他设备连接...
    </div>
  </div>
</template>

<style scoped>
.device-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.device-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--surface);
  border-radius: var(--radius);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: border-color 0.2s;
}

.device-item:hover {
  border-color: var(--primary);
}

.device-item.active {
  border-color: var(--primary);
  background: #eff6ff;
}

.device-icon {
  color: var(--text-secondary);
}

.device-info {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.device-name {
  font-weight: 500;
}

.device-status {
  font-size: 12px;
  color: var(--text-secondary);
}

.device-status.connected {
  color: var(--success);
}

.device-status.connecting {
  color: var(--warning);
}

.empty-state {
  text-align: center;
  padding: 32px;
  color: var(--text-secondary);
  font-size: 14px;
}
</style>
