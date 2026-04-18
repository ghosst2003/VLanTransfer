<script setup lang="ts">
import { ref } from 'vue'
import { formatBytes } from '../utils/file'
import type { TransferState } from '../types'

const props = defineProps<{
  transfers: Map<string, TransferState>
  disabled: boolean
}>()

const emit = defineEmits<{
  sendFile: [file: File]
}>()

const isDragging = ref(false)

function handleFileChange(e: Event) {
  const target = e.target as HTMLInputElement
  const files = target.files
  if (files && files.length > 0) {
    Array.from(files).forEach((file) => emit('sendFile', file))
    target.value = ''
  }
}

function handleDragEnter(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  isDragging.value = true
}

function handleDragLeave(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
    isDragging.value = false
  }
}

function handleDragOver(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
}

function handleDrop(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  isDragging.value = false

  const files = e.dataTransfer?.files
  if (files && files.length > 0 && !props.disabled) {
    Array.from(files).forEach((file) => emit('sendFile', file))
  }
}

function getDirectionLabel(transfer: TransferState): string {
  if (transfer.direction === 'in') return '收到'
  if (transfer.direction === 'out') return '发出'
  return ''
}
</script>

<template>
  <div class="file-transfer" :class="{ 'drag-over': isDragging }" @dragenter="handleDragEnter" @dragleave="handleDragLeave" @dragover="handleDragOver" @drop="handleDrop">
    <div class="transfer-header">
      <span class="transfer-title">文件传输</span>
      <label class="send-btn" :class="{ disabled }">
        发送文件
        <input type="file" :disabled="disabled" @change="handleFileChange" />
      </label>
    </div>

    <div v-if="isDragging" class="drop-overlay">
      <div class="drop-content">
        <svg class="drop-icon" viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        <span>拖拽文件到此处即可发送</span>
      </div>
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
  position: relative;
}

.file-transfer.drag-over {
  border-color: var(--primary);
  background: rgba(37, 99, 235, 0.05);
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

.drop-overlay {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  border: 2px dashed var(--primary);
  border-radius: var(--radius);
}

.drop-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: var(--primary);
  font-size: 16px;
  font-weight: 500;
  pointer-events: none;
}

.drop-icon {
  opacity: 0.8;
}
</style>
