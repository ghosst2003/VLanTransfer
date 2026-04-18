export const CHUNK_SIZE = 16 * 1024 // 16KB

export async function splitFile(file: File): Promise<ArrayBuffer[]> {
  const chunks: ArrayBuffer[] = []
  let offset = 0
  while (offset < file.size) {
    const slice = file.slice(offset, offset + CHUNK_SIZE)
    chunks.push(await slice.arrayBuffer())
    offset += CHUNK_SIZE
  }
  return chunks
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}
