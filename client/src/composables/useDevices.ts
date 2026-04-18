export function useDevices() {
  function generateUUID(): string {
    const hex = '0123456789abcdef'
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 2
    return [
      bytes.slice(0, 4).map(b => hex[b >> 4] + hex[b & 0x0f]).join(''),
      bytes.slice(4, 6).map(b => hex[b >> 4] + hex[b & 0x0f]).join(''),
      bytes.slice(6, 8).map(b => hex[b >> 4] + hex[b & 0x0f]).join(''),
      bytes.slice(8, 10).map(b => hex[b >> 4] + hex[b & 0x0f]).join(''),
      bytes.slice(10).map(b => hex[b >> 4] + hex[b & 0x0f]).join(''),
    ].join('-')
  }

  function generateDeviceId(): string {
    let id = localStorage.getItem('vlan-transfer-id')
    if (!id) {
      id = generateUUID()
      localStorage.setItem('vlan-transfer-id', id)
    }
    return id
  }

  function getDeviceName(): string {
    const ua = navigator.userAgent
    if (/iPhone|iPad|iPod/.test(ua)) return 'iPhone / iPad'
    if (/Android/.test(ua)) return 'Android'
    if (/Mac/.test(ua)) return 'Mac'
    if (/Windows/.test(ua)) return 'Windows'
    if (/Linux/.test(ua)) return 'Linux'
    return 'Unknown Device'
  }

  return { generateDeviceId, getDeviceName }
}
