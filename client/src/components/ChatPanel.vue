<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  messages: Array<{ content: string; from: string; timestamp: number }>
  disabled: boolean
}>()

const emit = defineEmits<{
  send: [content: string]
}>()

const input = ref('')

function handleSend() {
  const content = input.value.trim()
  if (!content) return
  emit('send', content)
  input.value = ''
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}
</script>

<template>
  <div class="chat-panel">
    <div class="messages">
      <div
        v-for="(msg, i) in messages"
        :key="i"
        class="message"
        :class="{ mine: msg.from === 'me' }"
      >
        <div class="bubble">{{ msg.content }}</div>
        <span class="time">{{ new Date(msg.timestamp).toLocaleTimeString() }}</span>
      </div>
      <div v-if="messages.length === 0" class="empty">暂无消息</div>
    </div>

    <div class="input-area">
      <input
        v-model="input"
        @keydown="handleKeydown"
        :disabled="disabled"
        type="text"
        placeholder="输入消息..."
      />
      <button @click="handleSend" :disabled="disabled || !input.trim()">
        发送
      </button>
    </div>
  </div>
</template>

<style scoped>
.chat-panel {
  display: flex;
  flex-direction: column;
  height: 400px;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.message {
  display: flex;
  flex-direction: column;
  max-width: 75%;
}

.message.mine {
  align-self: flex-end;
}

.bubble {
  padding: 8px 12px;
  border-radius: 12px;
  background: var(--bg);
  word-break: break-word;
}

.message.mine .bubble {
  background: var(--primary);
  color: white;
}

.time {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.message.mine .time {
  text-align: right;
}

.empty {
  text-align: center;
  color: var(--text-secondary);
  margin: auto;
  font-size: 14px;
}

.input-area {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}

.input-area input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 14px;
  outline: none;
}

.input-area input:focus {
  border-color: var(--primary);
}

.input-area input:disabled {
  background: var(--bg);
  opacity: 0.6;
}

.input-area button {
  padding: 10px 20px;
  background: var(--primary);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  white-space: nowrap;
}

.input-area button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 600px) {
  .chat-panel {
    height: 350px;
  }
}
</style>
