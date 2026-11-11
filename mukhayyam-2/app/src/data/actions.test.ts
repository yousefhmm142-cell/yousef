import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Action } from './actions'
const state = vi.hoisted(() => ({
  queue: [] as Action[],
  replies: [] as Array<Record<string, unknown>>,
  saved: vi.fn(),
}))
vi.mock('../config', () => ({ isDemo: false }))
vi.mock('./db', () => ({
  getMeta: async () => state.queue,
  setMeta: async (_: string, rows: Action[]) => {
    state.queue = rows
  },
}))
vi.mock('./rejected', () => ({ rememberRejected: (...args: unknown[]) => state.saved(...args) }))
vi.mock('./supabase', () => ({
  getSupabase: () => ({
    from: () => {
      const reply = state.replies.shift()
      const q = {
        insert: () => q,
        update: () => q,
        delete: () => q,
        eq: () => q,
        select: () => q,
        maybeSingle: () => q,
        abortSignal: () => q,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(reply).then(resolve),
      }
      return q
    },
  }),
}))
import { flushActions } from './actions'
const action: Action = {
  id: 'intent-1',
  table: 'tasks',
  op: 'update',
  rowId: 'task-1',
  row: { status: 'in_progress' },
  label: 'بدء مهمة 1',
}
beforeEach(() => {
  state.queue = [{ ...action }]
  state.replies = []
  state.saved.mockReset()
  state.saved.mockResolvedValue(true)
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('window', { dispatchEvent: vi.fn() })
})
describe('offline write recovery', () => {
  it('archives a refused intent before removing it from the queue', async () => {
    state.replies.push({ error: { code: '42501' }, status: 403 })
    state.saved.mockImplementation(async () => {
      expect(state.queue).toHaveLength(1)
      return true
    })
    await flushActions()
    expect(state.saved).toHaveBeenCalledWith(
      expect.objectContaining({ id: action.id, source: 'actions', payload: action }),
    )
    expect(state.queue).toHaveLength(0)
  })
  it('keeps the intent queued if the recovery history is full', async () => {
    state.replies.push({ error: { code: '42501' }, status: 403 })
    state.saved.mockResolvedValue(false)
    await flushActions()
    expect(state.queue).toEqual([action])
  })
  it('does not discard or archive a transient network failure', async () => {
    state.replies.push({ error: { message: 'network unavailable' }, status: 0 })
    await flushActions()
    expect(state.queue).toEqual([action])
    expect(state.saved).not.toHaveBeenCalled()
  })
  it('retains a change hidden by row security even when HTTP reports success', async () => {
    state.replies.push({ error: null, status: 200, data: [] })
    await flushActions()
    expect(state.saved).toHaveBeenCalledOnce()
    expect(state.queue).toHaveLength(0)
  })
  it('treats a repeated UUID insert as delivered only when that same row exists', async () => {
    state.queue = [{ ...action, op: 'insert', row: { id: 'task-1' } }]
    state.replies.push({ error: { code: '23505' }, status: 409 }, { error: null, status: 200, data: { id: 'task-1' } })
    await flushActions()
    expect(state.saved).not.toHaveBeenCalled()
    expect(state.queue).toHaveLength(0)
  })
  it('keeps a different unique-constraint conflict for review', async () => {
    state.queue = [{ ...action, op: 'insert', row: { id: 'task-1' } }]
    state.replies.push({ error: { code: '23505' }, status: 409 }, { error: null, status: 200, data: null })
    await flushActions()
    expect(state.saved).toHaveBeenCalledOnce()
    expect(state.queue).toHaveLength(0)
  })
})
