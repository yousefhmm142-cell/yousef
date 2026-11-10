/** A device-only verifier. Never store the PIN itself, or use this to sign into the server. */
export interface OfflinePin {
  version: 1
  employeeId: string
  phone: string
  salt: string
  hash: string
}

export const offlinePinKey = (employeeId: string) => `offline-pin:${employeeId}`
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

async function derive(employeeId: string, phone: string, pin: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${employeeId}:${phone}:${pin}`), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as Uint8Array<ArrayBuffer>, iterations: 100_000, hash: 'SHA-256' }, key, 256)
  return hex(new Uint8Array(bits))
}

export async function createOfflinePin(employeeId: string, phone: string, pin: string): Promise<OfflinePin> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return { version: 1, employeeId, phone, salt: hex(salt), hash: await derive(employeeId, phone, pin, salt) }
}

export async function verifyOfflinePin(saved: OfflinePin, employeeId: string, phone: string, pin: string): Promise<boolean> {
  if (saved.version !== 1 || saved.employeeId !== employeeId || saved.phone !== phone || !/^[a-f0-9]{32}$/.test(saved.salt) || !/^[a-f0-9]{64}$/.test(saved.hash)) return false
  const salt = new Uint8Array(saved.salt.match(/../g)!.map((s) => parseInt(s, 16)))
  const actual = await derive(employeeId, phone, pin, salt)
  let difference = 0
  for (let i = 0; i < actual.length; i++) difference |= actual.charCodeAt(i) ^ saved.hash.charCodeAt(i)
  return difference === 0
}
