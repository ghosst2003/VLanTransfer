export interface Device {
  id: string
  name: string
}

export interface Message {
  id: string
  from: string
  to: string
  content: string
  timestamp: number
}

export interface FileChunk {
  fileId: string
  fileName: string
  totalSize: number
  chunkIndex: number
  totalChunks: number
  data: ArrayBuffer
}

export interface TransferState {
  fileId: string
  fileName: string
  totalSize: number
  transferred: number
  progress: number
  status: 'sending' | 'receiving' | 'done' | 'error'
}

export interface SignalMessage {
  type: string
  payload: Record<string, unknown>
}
