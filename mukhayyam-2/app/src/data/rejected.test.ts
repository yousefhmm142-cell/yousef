import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ meta: new Map<string, unknown>(), put: vi.fn() }))
vi.mock('./db', () => ({
  getMeta: async (key: string) => state.meta.get(key),
  db: {
    meta: {
      put: (row: { key: string; value: unknown }) => {
        state.put(row)
        state.meta.set(row.key, row.value)
      },
    },
    transaction: async (_mode: string, _table: unknown, job: () => Promise<unknown>) => job(),
  },
}))
import { rememberRejected, safeRejectedValue } from './rejected'
const write = {
  id: 'intent-1',
  source: 'actions' as const,
  label: 'تعديل قراءة',
  code: 'refused',
  payload: { reading: 123 },
}
beforeEach(() => {
  state.meta.clear()
  state.put.mockReset()
  state.meta.set('profile', { id: 'owner-1' })
})
it('removes nested credentials while retaining the rejected business values', () => {
  const safe = safeRejectedValue({
    row: { reading: 123, subscriber_phone: '0590000005', link_token: 'PRIVATE_SENTINEL' },
    args: { p_pin: 'PRIVATE_SENTINEL', headers: { Authorization: 'PRIVATE_SENTINEL' } },
  })
  expect(JSON.stringify(safe)).not.toContain('PRIVATE_SENTINEL')
  expect(safe).toMatchObject({ row: { reading: 123, subscriber_phone: '0590000005' } })
})
it('removes task and attendance link secrets embedded in an outgoing message', () => {
  const safe = safeRejectedValue({
    body: 'مهمة جديدة https://example.test/t/PRIVATE_SENTINEL?x=1 وحضور /a/PRIVATE_SENTINEL',
  })
  expect(JSON.stringify(safe)).not.toContain('PRIVATE_SENTINEL')
  expect(safe).toMatchObject({ body: expect.stringContaining('مهمة جديدة') })
})
it('does not write another owner’s bucket', async () => {
  await rememberRejected(write)
  expect(state.meta.has('sync:rejected:owner-1')).toBe(true)
  expect([...state.meta.keys()].filter((k) => k.startsWith('sync:rejected:'))).toEqual(['sync:rejected:owner-1'])
})
it('keeps a refused queue item recoverable when there is no known signed-in owner', async () => {
  state.meta.delete('profile')
  expect(await rememberRejected(write)).toBe(false)
  expect(state.put).not.toHaveBeenCalled()
})
it('refuses to evict an older rejected write when the history is full', async () => {
  state.meta.set(
    'sync:rejected:owner-1',
    Array.from({ length: 1000 }, (_, i) => ({ ...write, id: `old-${i}` })),
  )
  expect(await rememberRejected(write)).toBe(false)
  expect(state.put).not.toHaveBeenCalled()
})
it('deduplicates recovery when a crash replays the same refused intent', async () => {
  expect(await rememberRejected(write)).toBe(true)
  expect(await rememberRejected(write)).toBe(true)
  expect(state.put).toHaveBeenCalledOnce()
})
