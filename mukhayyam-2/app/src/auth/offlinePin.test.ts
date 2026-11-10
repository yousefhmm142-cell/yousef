import { describe, expect, it } from 'vitest'
import { createOfflinePin, verifyOfflinePin } from './offlinePin'

describe('device PIN verification', () => {
  it('accepts the right code and gives each saved verifier its own salt', async () => {
    const first = await createOfflinePin('test-person', '0590000001', '123456')
    const second = await createOfflinePin('test-person', '0590000001', '123456')
    expect(first.salt).not.toBe(second.salt)
    expect(first.hash).not.toBe(second.hash)
    expect(first).not.toHaveProperty('pin')
    expect(await verifyOfflinePin(first, 'test-person', '0590000001', '123456')).toBe(true)
  })

  it('cannot unlock a different employee or phone, or accept a wrong code', async () => {
    const saved = await createOfflinePin('test-person', '0590000001', '123456')
    expect(await verifyOfflinePin(saved, 'test-person', '0590000001', '654321')).toBe(false)
    expect(await verifyOfflinePin(saved, 'someone-else', '0590000001', '123456')).toBe(false)
    expect(await verifyOfflinePin(saved, 'test-person', '0590000002', '123456')).toBe(false)
  })

  it('refuses a corrupt verifier instead of treating it as an unlocked session', async () => {
    const saved = await createOfflinePin('test-person', '0590000001', '123456')
    expect(await verifyOfflinePin({ ...saved, hash: '' }, 'test-person', '0590000001', '123456')).toBe(false)
    expect(await verifyOfflinePin({ ...saved, salt: 'invalid' }, 'test-person', '0590000001', '123456')).toBe(false)
  })
})
