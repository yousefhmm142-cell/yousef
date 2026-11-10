import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('../../data/db', () => ({ db: { tasks: { update: vi.fn().mockResolvedValue(1) } } }))
vi.mock('../../data/actions', () => ({ runOrQueue: vi.fn() }))
vi.mock('../../config', async () => ({
  ...(await vi.importActual<typeof import('../../config')>('../../config')),
  isDemo: false,
}))
vi.mock('../../lib/clock', async () => ({
  ...(await vi.importActual<typeof import('../../lib/clock')>('../../lib/clock')),
  serverNow: () => new Date('2026-11-10T08:00:00Z'),
}))
vi.mock('./repo', () => ({ refreshTasks: vi.fn().mockResolvedValue(true), useTasks: vi.fn(), useTaskTypes: vi.fn() }))
import { actOwnTask } from './MyTasksPage'
import { db } from '../../data/db'
import { runOrQueue } from '../../data/actions'
import type { Task } from './model'
afterEach(() => vi.unstubAllGlobals())
const task = (status: Task['status'] = 'new') =>
  ({ id: 'task', number: 5, assigneeId: 'owner', status, startedAt: null }) as Task
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('navigator', { onLine: false })
  vi.mocked(runOrQueue).mockImplementation(async (_a, local) => {
    await local()
    return 'queued'
  })
})
it('refuses another technician task and completion before start without writing or queueing', async () => {
  await expect(actOwnTask(task(), 'someone-else', 'start')).rejects.toThrow('not_allowed')
  await expect(actOwnTask(task(), 'owner', 'done')).rejects.toThrow('not_allowed')
  await expect(actOwnTask(task('done'), 'owner', 'start')).rejects.toThrow('not_allowed')
  expect(runOrQueue).not.toHaveBeenCalled()
  expect(db.tasks.update).not.toHaveBeenCalled()
})
it('queues the technician start with a device time and updates the local task', async () => {
  await actOwnTask(task(), 'owner', 'start')
  expect(runOrQueue).toHaveBeenCalledWith(
    expect.objectContaining({
      table: 'tasks',
      rowId: 'task',
      row: expect.objectContaining({
        status: 'in_progress',
        recorded_offline: true,
        device_time: '2026-11-10T08:00:00.000Z',
      }),
    }),
    expect.any(Function),
  )
  expect(db.tasks.update).toHaveBeenCalledWith(
    'task',
    expect.objectContaining({ status: 'in_progress', startedAt: '2026-11-10T08:00:00.000Z' }),
  )
})
it('keeps completion notes in the offline action and the local record', async () => {
  await actOwnTask(task('in_progress'), 'owner', 'done', '  تم الفحص  ')
  expect(runOrQueue).toHaveBeenCalledWith(
    expect.objectContaining({
      row: expect.objectContaining({ status: 'done', completion_notes: 'تم الفحص', recorded_offline: true }),
    }),
    expect.any(Function),
  )
  expect(db.tasks.update).toHaveBeenCalledWith(
    'task',
    expect.objectContaining({ status: 'done', completionNotes: 'تم الفحص' }),
  )
})
