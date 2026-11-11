import { Check,Stamp,UserRound } from 'lucide-react'
import { FootHint,SummaryAside,saveOnCtrlEnter } from '../../ui/SummaryAside'
import { useEffect,useMemo,useRef,useState } from 'react'
import { todayISO } from '../../lib/dates'
import { Dialog } from '../../ui/Dialog'
import { Chip,TextField } from '../../ui/form'
import { Button } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { addRoll,assignBatch,issueBatch,refreshSeals,sealErrorText,useTechnicians } from './repo'
import { latinDigits,ordinalWord,parseSealNumbers,sealStatusInfo,type SealBatch,type SealData,continueAfterSeparator,rollPrefix,withoutPendingStart } from './model'
import { dayLabel } from './parts'

// ---------- A new roll ----------
export function NewRollDialog({ onClose }: { onClose(): void }) {
  const toast = useToast()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const f = Number(latinDigits(from).replace(/\D/g, ''))
  const t = to ? Number(latinDigits(to).replace(/\D/g, '')) : f ? f + 99 : 0

  async function save() {
    if (!f) return setError('اكتب رقم أول ختم في الرول.')
    setBusy(true)
    setError(null)
    try {
      await addRoll(f, to ? t : null, date, note)
      toast(`سُجّل الرول ${f} - ${t}`)
      onClose()
    } catch (e) {
      setError(sealErrorText(e))
      setBusy(false)
    }
  }

  return (
    <Dialog
      className="seal-dialog"
      open
      onClose={onClose}
      title="رول أختام جديد"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button variant="primary" busy={busy} disabled={!f} onClick={() => void save()}>تسجيل الرول</Button>
        </>
      }
    >
      <div className="issue-form">
        <label className="seal-field">
          <span className="label">رقم أول ختم</span>
          <input inputMode="numeric" autoFocus value={from} placeholder="181301" onChange={(e) => setFrom(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
        </label>
        <label className="seal-field">
          <span className="label">رقم آخر ختم (اتركه فاضي = 100 ختم)</span>
          <input inputMode="numeric" value={to} placeholder={f ? String(f + 99) : '181400'} onChange={(e) => setTo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
        </label>
        <div className="issue-count"><span>عدد الأختام في الرول</span><b className="num">{f && t >= f ? t - f + 1 : '—'}</b></div>
        <label className="field">
          <span className="label">تاريخ الاستلام</span>
          <input type="date" className="input" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <TextField label="ملاحظة (اختياري)" value={note} onChange={setNote} />
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  )
}

// ---------- Preparing a batch (the name can come later) ----------
const LATER = 'later'

export function IssueDialog({ data, onClose, onDone, preset }: { data: SealData; onClose(): void; onDone(batchId: string): void; preset?: { rollId?: string } }) {
  const toast = useToast()
  const technicians = useTechnicians()
  /** A technician's id, or «لاحقاً» to prepare the seals now and give the name afterwards. */
  const [tech, setTech] = useState<string | null>(null)
  const [date, setDate] = useState(todayISO())
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)

  // The roll she is taking from: its first digits are fixed, only the last two are typed.
  const stocked = useMemo(() => data.rolls.filter((r) => data.seals.some((s) => s.rollId === r.id && s.status === 'in_stock')), [data.rolls, data.seals])
  const [rollId, setRollId] = useState<string | null>(preset?.rollId ?? null)
  const roll = data.rolls.find((r) => r.id === (rollId ?? stocked[0]?.id)) ?? null
  const prefix = roll ? rollPrefix(roll) : ''

  const bySeal = useMemo(() => new Map(data.seals.map((s) => [s.sealNo, s])), [data.seals])
  const parsed = useMemo(() => parseSealNumbers(withoutPendingStart(text, prefix)), [text, prefix])
  // The roll's last seal ends in 00 and carries the next hundred: «226800» typed on the roll 226801-226900 means 226900.
  const numbers = parsed.numbers.map((n) => (roll && n < roll.fromNo && n % 100 === 0 && n + 100 <= roll.toNo ? n + 100 : n))
  const rows = numbers.map((n) => {
    const s = bySeal.get(n)
    const bad = !s ? 'غير موجود' : s.status !== 'in_stock' ? sealStatusInfo[s.status].label : null
    return { n, s, bad }
  })
  const rolls = new Set(rows.flatMap((r) => (r.s ? [r.s.rollId] : [])))
  const mixed = rolls.size > 1
  const ok = rows.length > 0 && rows.every((r) => !r.bad) && !mixed && parsed.bad.length === 0 && tech !== null

  // The roll's first digits are already there when she starts, and again after each separator.
  useEffect(() => {
    setText(prefix)
    area.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roll?.id])
  // A number the screen does not know may belong to a roll added a moment ago (or by someone else): look again.
  const unknown = rows.some((r) => !r.s)
  useEffect(() => {
    if (unknown) void refreshSeals(true)
  }, [unknown, rows.length])

  async function submit(again: boolean) {
    if (!ok || tech === null) return
    setBusy(true)
    setError(null)
    try {
      const res = await issueBatch(tech === LATER ? null : tech, date, numbers)
      toast(tech === LATER ? `جُهّزت دفعة ${ordinalWord(res.batch_no)} (${res.count} أختام). اختر اسمها من «آخر ما صُرف».` : `صُرفت دفعة ${ordinalWord(res.batch_no)} (${res.count} أختام)`)
      onDone(res.batch_id)
      if (again) {
        setText(prefix)
        setTech(null)
        setBusy(false)
        area.current?.focus()
      } else onClose()
    } catch (e) {
      setError(sealErrorText(e))
      setBusy(false)
    }
  }

  const why = tech === null && rows.length > 0 && rows.every((r) => !r.bad) ? 'اختر الفني، أو «لاحقاً» لتجهيز الأختام وتسمية الدفعة بعدين.' : null

  const techName = tech === LATER ? 'لاحقاً (بدون اسم)' : technicians.find((t) => t.id === tech)?.fullName ?? ''
  const aside = (
    <SummaryAside
      title="ملخص الدفعة"
      bigLabel="عدد الأختام"
      big={<span className="num">{rows.length}</span>}
      rows={[['الرول', roll ? <span className="num">{roll.fromNo}–{roll.toNo}</span> : ''], ['من', rows[0] ? <span className="num">{rows[0].n}</span> : ''], ['إلى', rows.length > 1 ? <span className="num">{rows[rows.length - 1]!.n}</span> : '']]}
      more={[['الفني', techName], ['اليوم', dayLabel(date)]]}
      note={<span>{rows.some((r) => r.bad) ? 'في أرقام عليها ملاحظة بالأحمر، صحّحها قبل الصرف.' : 'بعد الصرف بتطلع بـ «آخر ما صُرف» وبتقدر تطبع ورقة الصرف.'}</span>}
    />
  )

  return (
    <Dialog
      className="seal-dialog"
      open
      onClose={onClose}
      title="تجهيز دفعة أختام"
      subtitle="اكتب آخر الرقم بس، وبداية الرول جاهزة."
      icon={<Stamp size={20} />}
      aside={aside}
      footer={
        <>
          <FootHint />
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button variant="secondary" disabled={!ok} busy={busy} onClick={() => void submit(true)}>حفظ وإضافة دفعة أخرى</Button>
          <Button variant="primary" icon={<Check size={17} />} disabled={!ok} busy={busy} onClick={() => void submit(false)}>
            {ok ? `${tech === LATER ? 'تجهيز' : 'صرف'} ${rows.length} ${rows.length > 10 ? 'ختماً' : 'أختام'}` : 'صرف'}
          </Button>
        </>
      }
    >
      <div className="issue-form" onKeyDown={saveOnCtrlEnter(() => void submit(false))}>
        {preset?.rollId && roll && <p className="field-hint">من الرول <b className="num">{roll.fromNo}–{roll.toNo}</b></p>}
        {/* Opened from a roll: that roll is the one. Opened from the big button: she picks. */}
        {!preset?.rollId && stocked.length > 1 && (
          <div className="field">
            <span className="label">من أي رول؟</span>
            <div className="chips">
              {stocked.map((r) => <Chip key={r.id} pressed={roll?.id === r.id} onClick={() => setRollId(r.id)}>{r.fromNo}–{r.toNo}</Chip>)}
            </div>
          </div>
        )}
        <label className="field">
          <span className="label">
            {roll ? <>اكتب أرقام الأختام. أول الرقم <b className="num roll-fixed">{prefix}</b> جاهز، وكل ما تضغط <b>مسافة</b> بيجيك من جديد وإنت كمّل الباقي (وبتقدر تعدّل عليه)</> : 'اكتب أرقام الأختام كاملة (حروف WK تُتجاهل)'}
          </span>
          <textarea
            ref={area}
            className="seal-input"
            dir="ltr"
            value={text}
            placeholder={roll ? `${prefix}02 ${prefix}35 ${prefix}87 …` : '181365 181388 181355 …'}
            onChange={(e) => setText(continueAfterSeparator(text, e.target.value, prefix, e.target.selectionStart === e.target.value.length))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit(false)
            }}
          />
        </label>
        <div className="parsed" aria-live="polite">
          {rows.map((r) => (
            <span key={r.n} className="seal-pill" data-status={r.s?.status ?? 'lost'} data-bad={r.bad ? true : undefined} title={r.bad ?? ''}>
              <i aria-hidden="true" />
              <span className="num">{r.n}</span>
              {r.bad && <small>{r.bad}</small>}
            </span>
          ))}
          {parsed.bad.map((b) => (
            <span key={b} className="seal-pill" data-status="lost" data-bad>
              <i aria-hidden="true" />
              <span className="num">{b}</span>
              <small>رقم غير صحيح</small>
            </span>
          ))}
          {parsed.duplicates.length > 0 && <small>مكرر وتم تجاهله: {parsed.duplicates.join('، ')}</small>}
        </div>
        <div className="issue-count">
          <span>{mixed ? 'الأرقام من أكثر من رول، جهّز كل رول لحاله' : 'عدد الأختام'}</span>
          <b className="num">{rows.length}</b>
        </div>
        <div className="field">
          <span className="label">لمن هذه الدفعة؟</span>
          <div className="chips">
            {technicians.map((t) => (
              <Chip key={t.id} pressed={tech === t.id} onClick={() => setTech(t.id)}>{t.fullName}</Chip>
            ))}
            <Chip pressed={tech === LATER} onClick={() => setTech(LATER)}>لاحقاً</Chip>
          </div>
        </div>
        <label className="field">
          <span className="label">اليوم (اليوم تلقائياً)</span>
          <input type="date" className="input" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {why && <p className="issue-why" role="status">{why}</p>}
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  )
}

// ---------- Giving a prepared batch its name ----------
export function AssignDialog({ batch, data, onClose }: { batch: SealBatch; data: SealData; onClose(): void }) {
  const toast = useToast()
  const technicians = useTechnicians()
  const [tech, setTech] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const count = data.seals.filter((s) => s.batchId === batch.id).length

  async function save() {
    if (!tech) return
    setBusy(true)
    setError(null)
    try {
      await assignBatch(batch.id, tech)
      toast(`سُلّمت الدفعة إلى ${technicians.find((t) => t.id === tech)?.fullName ?? ''}`)
      onClose()
    } catch (e) {
      setError(sealErrorText(e))
      setBusy(false)
    }
  }

  const aside = (
    <SummaryAside
      title="ملخص الدفعة"
      bigLabel="الفني"
      big={technicians.find((t) => t.id === tech)?.fullName ?? 'اختر الفني'}
      rows={[['الدفعة', batch.label?.trim() || ordinalWord(batch.batchNo)], ['عدد الأختام', <span className="num">{count}</span>], ['اليوم', dayLabel(batch.issuedOn)]]}
    />
  )

  return (
    <Dialog
      className="seal-dialog"
      open
      onClose={onClose}
      title={`لمن الدفعة ${batch.label?.trim() || ordinalWord(batch.batchNo)}؟`}
      subtitle="اختر الفني اللي استلم الأختام."
      icon={<UserRound size={20} />}
      aside={aside}
      footer={
        <>
          <FootHint />
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button variant="primary" busy={busy} disabled={!tech} onClick={() => void save()}>تسليم</Button>
        </>
      }
    >
      <div className="issue-form" onKeyDown={saveOnCtrlEnter(() => void save())}>
        <p className="field-hint"><span className="num">{count}</span> أختام جاهزة بدون اسم. اختر الفني اللي استلمها.</p>
        <div className="chips">
          {technicians.map((t) => <Chip key={t.id} pressed={tech === t.id} onClick={() => setTech(t.id)}>{t.fullName}</Chip>)}
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  )
}


// The other dialogs live in their own files; listed here so the pages import them from one place.
export { UseDialog } from './UseDialog'
export { EditBatchDialog, EditRollDialog, ImportDialog } from './editDialogs'
