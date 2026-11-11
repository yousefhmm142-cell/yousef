import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useEmployee } from '../../auth/AuthProvider'
import { describeDay,type ISODate } from '../../lib/dates'
import { clock12 } from '../../lib/format'
import type { Employee } from '../../types'
import { Dialog } from '../../ui/Dialog'
import { Chip,Segmented,TimeField } from '../../ui/form'
import { Button,Pill } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { useConfirm } from '../../ui/Confirm'
import { durationText } from '../tasks/model'
import {
addLeave,
addManualPunch,
deleteLeave,
deletePunch,
updatePunchTime
} from './repo'
import {
gazaTime,
leaveLabel,statusLabel,type LeaveType,
type PunchKind
} from './rules'
import { errText,statusTone,type Data } from './attendanceData'

export const LEAVE_REASONS = ['مراجعة طبية', 'مرض', 'ظرف عائلي', 'مناسبة', 'سفر', 'معاملة رسمية']

/** One person's day: the scans, and the manager's corrections (forgotten scan, leave). */
export function DayDialog({ employee, date, data, onClose }: { employee: Employee; date: ISODate; data: Data; onClose(): void }) {
  const me = useEmployee()
  const toast = useToast()
  const d = data.day(employee, date)
  const [kind, setKind] = useState<PunchKind>(d?.inAt && !d.outAt ? 'out' : 'in')
  const [time, setTime] = useState(d?.inAt && !d.outAt ? '17:00' : '08:00')
  const [reason, setReason] = useState('')
  const [leaveWhy, setLeaveWhy] = useState('')
  const [leaveType, setLeaveType] = useState<LeaveType>('annual')
  const [leaveDays, setLeaveDays] = useState(1)
  const [busy, setBusy] = useState<string | null>(null)
  const confirm = useConfirm()
  const { weekday, date: long } = describeDay(date)

  async function run(key: string, f: () => Promise<void>, done: string) {
    setBusy(key)
    try {
      await f()
      toast(done)
    } catch (e) {
      toast(errText(e), 'danger')
    } finally {
      setBusy(null)
    }
  }

  if (!d) return null
  return (
    <Dialog open onClose={onClose} title={`${employee.fullName} · ${weekday}`}>
      <div className="att-day">
        <div className="task-detail-head">
          <span className="muted num">{long}</span>
          <Pill tone={statusTone[d.status]}>{statusLabel[d.status] || 'لم يأتِ بعد'}</Pill>
          {d.earlyMin > 0 && <Pill tone="warn">خرج قبل الموعد بـ {durationText(d.earlyMin)}</Pill>}
          {d.overtimeMin > 0 && <Pill tone="ok">إضافي {durationText(d.overtimeMin)}</Pill>}
        </div>
        {d.punches.length ? (
          <ol className="task-steps att-punches">
            {d.punches.map((p) => (
              <li key={p.id}>
                <span>{p.kind === 'in' ? 'حضور' : 'انصراف'}{p.method === 'manual' && <small className="muted"> · يدوي: {p.reason}</small>}</span>
                <span className="att-punch-end">
                  <span className={`punch-time ${p.kind}`}>
                    <TimeField
                      label={`تعديل وقت ${p.kind === 'in' ? 'الحضور' : 'الانصراف'}`}
                      value={gazaTime(p.at)}
                      onChange={(v) => v && void run('edit', () => updatePunchTime(p, date, v, me.id), 'عُدّل الوقت')}
                    />
                  </span>
                  <button type="button" className="icon-btn sm" aria-label="حذف هذا التسجيل" disabled={!!busy}
                    onClick={async () => {
                      const yes = await confirm({
                        title: `حذف تسجيل ${p.kind === 'in' ? 'الحضور' : 'الانصراف'}؟`,
                        message: `سيُحذف تسجيل ${p.kind === 'in' ? 'حضور' : 'انصراف'} ${employee.fullName} الساعة ${clock12(gazaTime(p.at))}، ويتغيّر حساب يومه.`,
                        confirmLabel: 'حذف التسجيل',
                        danger: true,
                      })
                      if (yes) void run('del', () => deletePunch(p.id), 'حُذف التسجيل')
                    }}>
                    <Trash2 size={15} />
                  </button>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">لا تسجيلات في هذا اليوم.</p>
        )}

        <div className="att-manual">
          <b>سجّل حضور أو انصراف</b>
          <span className="field-hint">لمن نسي يصوّر، أو لتسجيل وقت عنه. لتعديل وقت مسجّل اضغط على الوقت فوق.</span>
          <div className="att-manual-row">
            <Segmented<PunchKind> label="النوع" value={kind} options={[{ value: 'in', label: 'حضور' }, { value: 'out', label: 'انصراف' }]} onChange={setKind} />
            <span className="punch-time"><TimeField label="وقت التسجيل" value={time} onChange={setTime} /></span>
          </div>
          <input className="input" placeholder="السبب (اختياري)، مثلاً: الجوال كان طافي" aria-label="السبب" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button variant="secondary" busy={busy === 'manual'} disabled={!time}
            onClick={() => void run('manual', () => addManualPunch(employee.id, date, time, kind, reason, me.id), 'سُجّل يدوياً')}>
            تسجيل {kind === 'in' ? 'الحضور' : 'الانصراف'}
          </Button>
        </div>

        <div className="att-manual">
          <b>إجازة هذا اليوم</b>
          {d.leave ? (
            <div className="att-manual-row">
              <Pill tone="info">{leaveLabel[d.leave.type]}</Pill>
              {d.leave.notes && <span className="muted">السبب: {d.leave.notes}</span>}
              <Button variant="ghost" busy={busy === 'unleave'} onClick={() => void run('unleave', () => deleteLeave(d.leave!.id), 'أُلغيت الإجازة')}>إلغاء الإجازة</Button>
            </div>
          ) : (
            <>
            <div className="chips">
              {(Object.keys(leaveLabel) as LeaveType[]).map((t) => <Chip key={t} pressed={leaveType === t} onClick={() => setLeaveType(t)}>{leaveLabel[t]}</Chip>)}
            </div>
            <input className="input" placeholder="السبب، مثلاً: مراجعة طبية" aria-label="سبب الإجازة" value={leaveWhy} onChange={(e) => setLeaveWhy(e.target.value)} />
            <div className="chips quick-why">
              {LEAVE_REASONS.map((r) => <Chip key={r} pressed={leaveWhy === r} onClick={() => setLeaveWhy(leaveWhy === r ? '' : r)}>{r}</Chip>)}
            </div>
            <div className="att-manual-row">
              <Segmented<string> label="المدة" value={String(leaveDays)} options={[{ value: '1', label: 'يوم' }, { value: '2', label: 'يومين' }, { value: '3', label: '3 أيام' }, { value: '7', label: 'أسبوع' }]} onChange={(v) => setLeaveDays(Number(v))} />
              <Button variant="secondary" busy={busy === 'leave'} disabled={!!busy}
                onClick={() => void run('leave', () => addLeave(employee.id, date, leaveType, me.id, leaveWhy, leaveDays), `سُجّلت ${leaveLabel[leaveType]}${leaveDays > 1 ? ` (${leaveDays} أيام)` : ''}`)}>
                تسجيل {leaveLabel[leaveType]}
              </Button>
            </div>
            </>
          )}
        </div>
      </div>
    </Dialog>
  )
}

