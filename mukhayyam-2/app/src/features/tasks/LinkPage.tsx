import { CheckCircle2, CircleAlert, MapPin, Phone, Play, Plus, WifiOff, X } from 'lucide-react'
import { parseDecimal } from '../../lib/numbers'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { formatTime } from '../../lib/format'
import { formatPhone } from '../../lib/phone'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { useOnline } from '../../lib/useOnline'
import { Button, Logo, Pill } from '../../ui/primitives'
import { useConfirmTap } from '../sheets/useDraft'
import { SheetStateError } from '../sheets/workflow'
import { durationText, priorityInfo } from './model'
import { actOnTaskLink, openTaskLink, type LinkTask, type UsedMaterial } from './repo'

type State = { kind: 'loading' } | { kind: 'missing' } | { kind: 'offline' } | { kind: 'ready'; task: LinkTask }

/**
 * What a technician sees after tapping the link at the end of the order: the order itself and one
 * big "finished" button. No app and no sign-in; the link opens this one task only.
 */
export function TaskLinkPage() {
  const { token = '' } = useParams()
  const online = useOnline()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [notes, setNotes] = useState('')
  const [used, setUsed] = useState<UsedMaterial[]>([])
  const [busy, setBusy] = useState<'start' | 'done' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [armed, arm, disarm] = useConfirmTap()
  useDocumentTitle(state.kind === 'ready' ? `مهمة ${state.task.number}` : 'مهمة')

  useEffect(() => {
    let alive = true
    openTaskLink(token)
      .then((task) => alive && setState(task ? { kind: 'ready', task } : { kind: 'missing' }))
      .catch((e) => alive && setState(e instanceof SheetStateError && e.message === 'offline' ? { kind: 'offline' } : { kind: 'missing' }))
    return () => {
      alive = false
    }
  }, [token, online])

  async function act(action: 'start' | 'done') {
    if (action === 'done' && !armed) return arm()
    setBusy(action)
    setError(null)
    try {
      const task = await actOnTaskLink(token, action, notes, action === 'done' ? used : [])
      if (task) setState({ kind: 'ready', task })
    } catch (e) {
      const code = e instanceof SheetStateError ? e.message : ''
      setError(code === 'offline' ? 'لا يوجد إنترنت. اتصل واضغط مرة ثانية.' : code === 'cancelled' ? 'ألغى المدير هذه المهمة.' : 'لم يُحفظ. حاول مرة ثانية.')
    } finally {
      setBusy(null)
      disarm()
    }
  }

  return (
    <div className="tlink">
      <header className="tlink-head">
        <Logo height={34} />
        <span>مخيم 2</span>
      </header>

      {state.kind === 'loading' && <div className="loading-block" aria-busy="true" />}

      {state.kind === 'offline' && (
        <div className="empty card">
          <span className="halo"><WifiOff size={28} /></span>
          <h3>لا يوجد إنترنت</h3>
          <p>افتح الرابط مرة ثانية لما يرجع النت.</p>
        </div>
      )}

      {state.kind === 'missing' && (
        <div className="empty card">
          <span className="halo"><CircleAlert size={28} /></span>
          <h3>الرابط غير صحيح</h3>
          <p>افتحه من رسالة المهمة كما هو، أو اطلب من المدير إعادة إرسالها.</p>
        </div>
      )}

      {state.kind === 'ready' && <TaskView task={state.task} />}

      {state.kind === 'ready' && (state.task.status === 'done' ? (
        <section className="tlink-done card">
          <CheckCircle2 size={44} />
          <h2>أُنجزت المهمة</h2>
          <p className="num">الساعة {formatTime(new Date(state.task.completed_at!))}. وصلت للمدير، شكراً لك.</p>
          {state.task.completion_notes && <p className="muted">ملاحظتك: {state.task.completion_notes}</p>}
          {!!state.task.materials?.length && (
            <p className="muted">المواد: {state.task.materials.map((m) => `${m.name} ${m.qty} ${m.unit}`).join('، ')}</p>
          )}
        </section>
      ) : state.task.status === 'cancelled' ? (
        <section className="tlink-done card cancelled">
          <CircleAlert size={40} />
          <h2>ألغى المدير هذه المهمة</h2>
          <p>لا داعي لتنفيذها.</p>
        </section>
      ) : (
        <section className="tlink-actions">
          {state.task.status !== 'in_progress' ? (
            <Button variant="secondary" size="lg" block icon={<Play size={18} />} busy={busy === 'start'} onClick={() => void act('start')}>
              بدأت العمل
            </Button>
          ) : (
            <p className="tlink-started num">بدأت الساعة {formatTime(new Date(state.task.started_at!))}</p>
          )}
          {!!state.task.items?.length && <Materials items={state.task.items} used={used} onChange={setUsed} />}
          <label className="field">
            <span className="label">ملاحظة للمدير (اختياري)</span>
            <textarea className="textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="مثلاً: تم التبديل، العداد القديم مع الفني" />
          </label>
          <Button variant="primary" size="lg" block icon={<CheckCircle2 size={20} />} busy={busy === 'done'} onClick={() => void act('done')} className="tlink-finish">
            {armed ? 'اضغط مرة ثانية للتأكيد' : 'أنهيت المهمة'}
          </Button>
          {error && <p className="field-error" role="alert">{error}</p>}
        </section>
      ))}
    </div>
  )
}

function TaskView({ task }: { task: LinkTask }) {
  return (
    <section className="tlink-task card">
      <div className="tlink-title">
        <span className="muted num">مهمة رقم {task.number}</span>
        {task.priority !== 'normal' && <Pill tone={priorityInfo[task.priority].tone}>{priorityInfo[task.priority].label}</Pill>}
      </div>
      <h1>{task.type}</h1>
      {task.details && <p className="tlink-details">{task.details}</p>}
      <ul className="tlink-facts">
        {(task.subscriber_name || task.subscriber_phone) && (
          <li>
            <Phone size={16} />
            <span>
              {task.subscriber_name}
              {task.subscriber_phone && (
                <> · <a href={`tel:${task.subscriber_phone}`} className="num ltr">{formatPhone(task.subscriber_phone)}</a></>
              )}
            </span>
          </li>
        )}
        {(task.zone || task.location) && <li><MapPin size={16} /><span>{[task.zone, task.location].filter(Boolean).join(' · ')}</span></li>}
        <li className="muted"><span>المدة المتوقعة: {durationText(task.expected_minutes)} · {task.assignee}</span></li>
      </ul>
    </section>
  )
}

/** What the technician took from the warehouse for this task (optional). */
function Materials({ items, used, onChange }: { items: Array<{ id: number; name: string; unit: string }>; used: UsedMaterial[]; onChange(v: UsedMaterial[]): void }) {
  return (
    <div className="field tlink-materials">
      <span className="label">المواد المستخدمة (اختياري)</span>
      {used.map((m, i) => (
        <div key={i} className="tlink-mat">
          <select className="select" aria-label="الصنف" value={m.itemId} onChange={(e) => onChange(used.map((x, j) => (j === i ? { ...x, itemId: Number(e.target.value) } : x)))}>
            {items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
          </select>
          <input
            className="input num"
            inputMode="decimal"
            aria-label="الكمية"
            placeholder={items.find((it) => it.id === m.itemId)?.unit ?? 'الكمية'}
            value={m.qty || ''}
            onChange={(e) => onChange(used.map((x, j) => (j === i ? { ...x, qty: parseDecimal(e.target.value) ?? 0 } : x)))}
          />
          <button type="button" className="icon-btn sm" aria-label="إزالة" onClick={() => onChange(used.filter((_, j) => j !== i))}><X size={15} /></button>
        </div>
      ))}
      <button type="button" className="link-btn" onClick={() => onChange([...used, { itemId: items[0]!.id, qty: 1 }])}>
        <Plus size={16} /> إضافة مادة
      </button>
    </div>
  )
}
