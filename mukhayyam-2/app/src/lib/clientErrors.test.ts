import { describe, expect, it, vi } from 'vitest'
vi.mock('../data/supabase', () => ({ getSupabase: () => null }))
vi.mock('../config', () => ({ isDemo: true }))
import { safeRoute } from './clientErrors'
describe('private diagnostic routes', () => {
  it('never records task or attendance tokens, even if the token contains only letters', () => {
    expect(safeRoute('/t/abcdef')).toBe('/t/[private]')
    expect(safeRoute('/a/secret123?pin=123456')).toBe('/a/[private]')
  })
  it('keeps useful screen names but removes dates, phones, unknown segments and query strings', () => {
    expect(safeRoute('/entry/2026-11-10?secret=anything')).toBe('/entry/:date')
    expect(safeRoute('/tasks/0590000001')).toBe('/tasks/[private]')
    expect(safeRoute('/settings')).toBe('/settings')
    expect(safeRoute('/my-tasks')).toBe('/my-tasks')
    expect(safeRoute('/my-attendance')).toBe('/my-attendance')
    expect(safeRoute('/untrustedwords')).toBe('/[private]')
  })
})
