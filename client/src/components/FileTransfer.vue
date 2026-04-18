<script setup lang="ts">
import { formatBytes } from '../utils/file'
import type { TransferState } from '../types'

defineProps<{
  transfers: Map<string, TransferState>
  disabled: boolean
}>()

const emit = defineEmits<{
  sendFile: [file: File]
}>()

function handleFileChange(e: Event) {
  const target = e.target as HTMLInputElement
  const files = target.files
  if (files && files.length > 0) {
    Array.from(files).forEach((file) => emit('sendFile', file))
    target.value = ''
  }
}

function getDirectionLabel(transfer: TransferState): string {
  if (transfer.direction === 'in') return '收到'
  if (transfer.direction === 'out') return '发出'
  return ''
}
</script>

<template>
  <div class="file-transfer">
    <div class="transfer-header">
      <span class="transfer-title">文件传输</span>
      <label class="send-btn" :class="{ disabled }">
        发送文件
        <input type="file" :disabled="disabled" @change="handleFileChange" />
      </label>
    </div>

    <div class="transfer-list">
      <div v-for="transfer in transfers.values()" :key="transfer.fileName + transfer.progress + transfer.status" class="transfer-item" :class="transfer.status">
        <div class="transfer-info">
          <span class="file-name">{{ transfer.fileName }}</span>
          <span class="file-size">{{ formatBytes(transfer.totalSize) }}</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: transfer.progress + '%' }"></div>
        </div>
        <div class="transfer-status">
          <span class="direction-tag" v-if="transfer.direction">{{ getDirectionLabel(transfer) }}</span>
          <span class="status-text" :class="transfer.status">
            {{ transfer.status === 'sending' ? '发送中' : transfer.status === 'receiving' ? '接收中' : transfer.status === 'done' ? '完成' : '错误' }}
            {{ transfer.status === 'done' ? '' : transfer.progress + '%' }}
          </span>
        </div>
      </div>
      <div v-if="transfers.size === 0" class="empty">暂无传输记录</div>
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
  position: relative;
  display: inline-block;
  padding: 6px 16px;
  background: var(--primary);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  overflow: hidden;
}

.send-btn input[type="file"] {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.send-btn.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.transfer-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 300px;
  overflow-y: auto;
}

.transfer-item {
  padding: 8px 0;
}

.transfer-item.done {
  opacity: 0.7;
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

.transfer-item.done .progress-fill {
  background: var(--success);
}

.transfer-status {
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.direction-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  background: #e0e7ff;
  color: #3730a3;
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
