<script setup lang="ts">
import { ref } from 'vue'
import { formatBytes } from '../utils/file'
import type { TransferState } from '../types'

defineProps<{
  transfers: Map<string, TransferState>
  disabled: boolean
}>()

const emit = defineEmits<{
  sendFile: [file: File]
}>()

const fileInput = ref<HTMLInputElement | null>(null)

function handleFileChange(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) {
    emit('sendFile', file)
    target.value = ''
  }
}
</script>

<template>
  <div class="file-transfer">
    <div class="transfer-header">
      <span class="transfer-title">文件传输</span>
      <button class="send-btn" :disabled="disabled" @click="fileInput?.click()">
        发送文件
      </button>
      <input ref="fileInput" type="file" style="display: none" @change="handleFileChange" />
    </div>

    <div class="transfer-list">
      <div v-for="transfer in transfers.values()" :key="transfer.fileName" class="transfer-item">
        <div class="transfer-info">
          <span class="file-name">{{ transfer.fileName }}</span>
          <span class="file-size">{{ formatBytes(transfer.totalSize) }}</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: transfer.progress + '%' }"></div>
        </div>
        <div class="transfer-status">
          <span class="status-text" :class="transfer.status">
            {{ transfer.status === 'sending' ? '发送中' : transfer.status === 'receiving' ? '接收中' : transfer.status === 'done' ? '完成' : '错误' }}
            {{ transfer.progress }}%
          </span>
        </div>
      </div>
      <div v-if="transfers.size === 0" class="empty">暂无传输</div>
    </div>
  </div>
</template>

<style scoped>
.file-transfer {
  border-top: 1px solid var(--border);
  padding: 12px 16px;
}

.transfer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.transfer-title {
  font-weight: 600;
  font-size: 14px;
}

.send-btn {
  padding: 6px 16px;
  background: var(--primary);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}

.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.transfer-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.transfer-item {
  padding: 8px 0;
}

.transfer-info {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}

.file-name {
  font-size: 13px;
  max-width: 70%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  font-size: 12px;
  color: var(--text-secondary);
}

.progress-bar {
  height: 4px;
  background: var(--border);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--primary);
  transition: width 0.2s;
}

.transfer-status {
  margin-top: 4px;
}

.status-text {
  font-size: 12px;
  color: var(--text-secondary);
}

.status-text.done {
  color: var(--success);
}

.empty {
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
  padding: 8px 0;
}
</style>
