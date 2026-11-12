import { EmptyArt } from '../../ui/fx/EmptyArt'
import { useEffect, useState } from 'react'
import { useEmployee } from '../../auth/AuthProvider'
import { db } from '../../data/db'
import { runOrQueue } from '../../data/actions'
import { isDemo } from '../../config'
import { serverNow } from '../../lib/clock'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { Button, Pill } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { useConfirm } from '../../ui/Confirm'
import { refreshTasks, useTasks, useTaskTypes } from './repo'
import { isAssignedTo, isSharedTask, isOpen, taskStatusInfo, type Task } from './model'
import { buzz } from '../../lib/appearance'

export async function actOwnTask(task: Task, employeeId: string, action: 'start' | 'done', notes = '') {
  if (!isAssignedTo(task,employeeId) || isSharedTask(task) || !isOpen(task) || (action === 'done' && task.status !== 'in_progress'))
    throw new Error('not_allowed')
  const now = serverNow().toISOString()
  const changes =
    action === 'start'
      ? { status: 'in_progress' as const, startedAt: task.startedAt ?? now }
      : { status: 'done' as const, completedAt: now, completionNotes: notes.trim() }
  const local = async () => {
    await db.tasks.update(task.id, changes)
  }
  if (isDemo) {
    await local()
    return
  }
  const row = action === 'start' ? { status: 'in_progress' } : { status: 'done', completion_notes: notes.trim() }
  const outcome = await runOrQueue(
    {
      table: 'tasks',
      op: 'update',
      rowId: task.id,
      row: { ...row, recorded_offline: !navigator.onLine, device_time: now },
      label: `${action === 'start' ? 'بدء' : 'إنجاز'} مهمة ${task.number}`,
    },
    local,
  )
  if (outcome === 'sent') {
    await local()
    await refreshTasks()
  }
}
export function MyTasksPage() {
  const me = useEmployee(),
    tasks = useTasks(),
    types = useTaskTypes(),
    toast = useToast(),
    confirm = useConfirm()
  const [busy, setBusy] = useState<string | null>(null),
    [past, setPast] = useState(false),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [error, setError] = useState(false)
  useDocumentTitle('مهامي')
  useEffect(() => {
    let alive = true
    const load = () => {
      void refreshTasks()
        .then((updated) => {
          if (alive) setError(!updated)
        })
        .catch(() => {
          if (alive) setError(true)
        })
    }
    load()
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, 15000)
    window.addEventListener('online', load)
    return () => {
      alive = false
      window.clearInterval(id)
      window.removeEventListener('online', load)
    }
  }, [])
  const mine = (tasks ?? []).filter((t) => isAssignedTo(t,me.id) && (past ? !isOpen(t) : isOpen(t)))
  async function act(t: Task) {
    if (busy) return
    const action = t.status === 'in_progress' ? 'done' : 'start'
    if (action === 'done' && !(await confirm({ title: `خلّصت المهمة ${t.number}؟`, confirmLabel: 'خلصت' }))) return
    setBusy(t.id)
    try {
      await actOwnTask(t, me.id, action, notes[t.id] ?? '')
      if (action === 'done') buzz()
      toast(navigator.onLine ? 'انحفظت المهمة' : 'انحفظت على جهازك، بتتزامن لما يرجع النت')
    } catch {
      toast('تعذّر حفظ المهمة. حاول مرة ثانية.', 'danger')
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="personal-page">
      <header className="ph">
        <div>
          <h1>مهامي</h1>
          <p className="muted">مهامك من المكتب. ابدأ الشغل، ولما تخلص علّمها منجزة.</p>
        </div>
      </header>
      <div className="chips">
        <Button variant={!past ? 'primary' : 'secondary'} onClick={() => setPast(false)}>
          المفتوحة
        </Button>
        <Button variant={past ? 'primary' : 'secondary'} onClick={() => setPast(true)}>
          السابقة
        </Button>
      </div>
      {error && (
        <p role="status" className="banner warn">
          تعذّر تحديث القائمة. المعروض هو المحفوظ على جهازك.
        </p>
      )}
      {!tasks ? (
        <p role="status">جاري تحميل مهامك…</p>
      ) : !mine.length ? (
        <section className="card personal-empty"><EmptyArt kind="tech" />{past ? 'ما في مهام سابقة.' : 'ما عندك مهام مفتوحة.'}</section>
      ) : (
        mine.map((t) => (
          <article key={t.id} className="card personal-task">
            <header>
              <h2>
                {types?.find((x) => x.id === t.typeId)?.name ?? 'مهمة'} <span className="num">#{t.number}</span>
              </h2>
              <Pill tone={taskStatusInfo[t.status].tone}>{taskStatusInfo[t.status].label}</Pill>
            </header>
            {isSharedTask(t) && <p className="muted">مهمة مشتركة · المكتب بيسجّل إنجازها.</p>}
            {t.details && <p>{t.details}</p>}
            {t.subscriberName && <p>المشترك: {t.subscriberName}</p>}
            {t.location && <p>المكان: {t.location}</p>}
            {t.subscriberPhone && (
              <a className="btn" href={`tel:${t.subscriberPhone}`}>
                اتصال بالمشترك
              </a>
            )}
            {t.status === 'in_progress' && !isSharedTask(t) && (
              <label>
                ملاحظات الإنجاز (اختياري)
                <textarea
                  className="textarea"
                  value={notes[t.id] ?? ''}
                  onChange={(e) => setNotes((s) => ({ ...s, [t.id]: e.target.value }))}
                />
              </label>
            )}
            {isOpen(t) && !isSharedTask(t) && (
              <Button variant="primary" block busy={busy === t.id} disabled={busy !== null} onClick={() => void act(t)}>
                {t.status === 'in_progress' ? 'خلصت المهمة' : 'ابدأ الشغل'}
              </Button>
            )}
            {t.completionNotes && <p>{t.completionNotes}</p>}
          </article>
        ))
      )}
    </div>
  )
}
