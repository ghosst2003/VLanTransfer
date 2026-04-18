export function useDevices() {
  function generateUUID(): string {
    const hex = '0123456789abcdef'
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const toHex = (b: number) => hex[b >> 4] + hex[b & 0x0f]
    return [
      Array.from(bytes.slice(0, 4)).map(toHex).join(''),
      Array.from(bytes.slice(4, 6)).map(toHex).join(''),
      Array.from(bytes.slice(6, 8)).map(toHex).join(''),
      Array.from(bytes.slice(8, 10)).map(toHex).join(''),
      Array.from(bytes.slice(10)).map(toHex).join(''),
    ].join('-')
  }

  function generateDeviceId(): string {
    // Use sessionStorage so each browser tab gets a unique device ID
    let id = sessionStorage.getItem('vlan-transfer-id')
    if (!id) {
      id = generateUUID()
      sessionStorage.setItem('vlan-transfer-id', id)
    }
    return id
  }

  function getDeviceName(): string {
    const ua = navigator.userAgent
    let platform: string
    if (/iPhone|iPad|iPod/.test(ua)) platform = 'iPhone'
    else if (/Android/.test(ua)) platform = 'Android'
    else if (/Mac/.test(ua)) platform = 'Mac'
    else if (/Windows/.test(ua)) platform = 'Windows'
    else if (/Linux/.test(ua)) platform = 'Linux'
    else platform = 'Device'

    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let suffix = ''
    const randBytes = new Uint8Array(4)
    crypto.getRandomValues(randBytes)
    for (let i = 0; i < 4; i++) {
      suffix += chars[randBytes[i] % chars.length]
    }
    return `${platform}-${suffix}`
  }

  return { generateDeviceId, getDeviceName }
}
