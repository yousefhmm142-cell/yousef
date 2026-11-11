import { Check, FileSpreadsheet, Stamp, Upload, UserRound } from 'lucide-react'
import { FootHint, SummaryAside, saveOnCtrlEnter } from '../../ui/SummaryAside'
import { useEffect, useMemo, useRef, useState } from 'react'
import { todayISO } from '../../lib/dates'
import { Dialog } from '../../ui/Dialog'
import { Chip, TextField } from '../../ui/form'
import { Button } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { useConfirm } from '../../ui/Confirm'
import { SubscriberField } from '../tasks/SubscriberField'
import { addRoll, addToBatch, assignBatch, importRoll, importTechnician, importUsage, issueBatch, recordSeal, refreshSeals, returnToStock, sealErrorText, updateBatch, updateRoll, useTechnicians } from './repo'
import { parseIssueWorkbook, parseUsageWorkbook, planImport, rollPayload, usagePayload, type ImportPlan } from './import'
import { composeDetails, latinDigits, ordinalWord, parseSealNumbers, sealStatusInfo, splitDetails, WORK_CHOICES, type Seal, type SealBatch, type SealData, type SealRoll, continueAfterSeparator, rollPrefix, withoutPendingStart } from './model'
import { SealHistoryButton } from './SealHistory'
import { dayLabel, SealPill } from './parts'

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

// ---------- What happened to a seal ----------
type Outcome = 'used' | 'damaged' | 'lost'
const outcomes: Array<{ value: Outcome; label: string }> = [
  { value: 'used', label: 'مستخدم' },
  { value: 'damaged', label: 'تالف' },
  { value: 'lost', label: 'ضائع' },
]

export function UseDialog({ data, seal, onClose }: { data: SealData; seal?: Seal; onClose(): void }) {
  const toast = useToast()
  const [no, setNo] = useState(seal ? String(seal.sealNo) : '')
  const [status, setStatus] = useState<Outcome>(seal && (seal.status === 'damaged' || seal.status === 'lost') ? seal.status : 'used')
  const [date, setDate] = useState(seal?.usedOn ?? todayISO())
  const start = seal ? splitDetails(seal.details, seal.boardNo) : { board: '', work: '', subscriber: '' }
  const [board, setBoard] = useState(start.board)
  const [work, setWork] = useState(start.work)
  const [subscriber, setSubscriber] = useState(start.subscriber)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const first = useRef<HTMLInputElement>(null)
  const boardBox = useRef<HTMLInputElement>(null)

  const n = parseSealNumbers(no).numbers[0]
  const found = n ? data.seals.find((s) => s.sealNo === n) : undefined
  const typed = no.replace(/\D/g, '').length >= 6
  const bad = typed && !found ? 'هذا الرقم غير موجود في أي رول مسجّل.' : found && !found.technicianId && status === 'used' ? (found.status === 'issued' ? 'دفعة هذا الختم بدون اسم بعد: اختر اسمها من «آخر ما صُرف» أولاً.' : 'هذا الختم لم يُصرف لفني بعد.') : null
  const batch = found?.batchId ? data.batches.find((b) => b.id === found.batchId) : null
  const line = status === 'used' ? composeDetails({ board, work, subscriber }) : work.trim() || (status === 'damaged' ? 'تالف' : 'ضائع')

  useEffect(() => {
    ;(seal ? boardBox : first).current?.focus()
  }, [seal])
  // When the number typed reaches a seal that already has details, show them for editing.
  useEffect(() => {
    if (seal || !found) return
    if (found.status === 'used' || found.status === 'damaged' || found.status === 'lost') {
      const d = splitDetails(found.details, found.boardNo)
      setBoard(d.board)
      setWork(d.work)
      setSubscriber(d.subscriber)
      setStatus(found.status === 'used' ? 'used' : found.status)
      if (found.usedOn) setDate(found.usedOn)
    }
  }, [found?.sealNo]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save(next: boolean) {
    if (!found || bad) return
    setBusy(true)
    setError(null)
    try {
      await recordSeal(found.sealNo, status, date, line)
      toast(`سُجّل الختم ${found.sealNo}`)
      if (next && !seal) {
        setNo('')
        setBoard('')
        setWork('')
        setSubscriber('')
        setStatus('used')
        setBusy(false)
        first.current?.focus()
      } else onClose()
    } catch (e) {
      setError(sealErrorText(e))
      setBusy(false)
    }
  }

  const ready = !!found && !bad && (status !== 'used' || board.trim() !== '' || work.trim() !== '')
  // Undo the record, or take the seal back to the stock: asks first, in a window.
  const confirm = useConfirm()
  const recorded = !!seal && seal.status !== 'in_stock' && seal.status !== 'issued'
  async function undo(kind: 'undo' | 'stock') {
    if (!seal) return
    const yes = await confirm(
      kind === 'undo'
        ? { title: `إلغاء تسجيل الختم ${seal.sealNo}؟`, message: 'يرجع الختم «غير مستخدم» ويُمسح ما سُجّل عليه (الطبلون والعمل).', confirmLabel: 'إلغاء التسجيل', danger: true }
        : { title: `إرجاع الختم ${seal.sealNo} للمخزن؟`, message: 'يخرج من الفني ويرجع جاهزاً للصرف، ويُمسح أي تسجيل عليه.', confirmLabel: 'إرجاع للمخزن', danger: true },
    )
    if (!yes) return
    setBusy(true)
    try {
      if (kind === 'undo') await recordSeal(seal.sealNo, 'issued', null, '')
      else await returnToStock([seal.sealNo])
      toast(kind === 'undo' ? `أُلغي تسجيل الختم ${seal.sealNo}` : `رجع الختم ${seal.sealNo} للمخزن`)
      onClose()
    } catch (e) {
      setError(sealErrorText(e))
      setBusy(false)
    }
  }

  const aside = (
    <SummaryAside
      title="ملخص الختم"
      bigLabel="رقم الختم"
      big={found ? <span className="num">{found.sealNo}</span> : ''}
      rows={[['الفني', found?.technicianId ? data.names.get(found.technicianId) ?? '' : ''], ['الحالة', status === 'used' ? 'مستخدم' : status === 'damaged' ? 'تالف' : 'ضائع'], ['التاريخ', dayLabel(date)]]}
      more={status === 'used' ? [['المشترك', subscriber.trim()], ['الطبلون', board.trim()], ['العمل', work.trim()]] : [['ملاحظة', work.trim()]]}
      note={line ? <span>بينكتب بالسجل: «{line}»</span> : undefined}
    />
  )

  return (
    <Dialog
      className="seal-dialog"
      open
      onClose={onClose}
      title={seal ? `الختم ${seal.sealNo}` : 'تسجيل استخدام ختم'}
      subtitle="اكتب اسم المشترك وبيتعبّى الطبلون لحاله."
      icon={<Stamp size={20} />}
      aside={aside}
      footer={
        <>
          <FootHint />
          {seal && <SealHistoryButton table="seals" record={String(seal.sealNo)} label="سجل الختم" />}
          {seal && recorded && <Button variant="ghost" disabled={busy} onClick={() => void undo('undo')}>إلغاء التسجيل</Button>}
          {seal && seal.status !== 'in_stock' && <Button variant="ghost" disabled={busy} onClick={() => void undo('stock')}>إرجاع للمخزن</Button>}
          <Button variant="ghost" onClick={onClose}>إغلاق</Button>
          {!seal && <Button variant="secondary" disabled={!ready} busy={busy} onClick={() => void save(true)}>حفظ والتالي</Button>}
          <Button variant="primary" icon={<Check size={17} />} disabled={!ready} busy={busy} onClick={() => void save(false)}>حفظ</Button>
        </>
      }
    >
      <div className="issue-form" onKeyDown={saveOnCtrlEnter(() => { if (ready && !busy) void save(false) })}>
        {!seal && (
          <label className="seal-field">
            <span className="label">رقم الختم (يكفي الرقم، وحروف WK تُتجاهل)</span>
            <input
              ref={first}
              inputMode="numeric"
              value={no}
              placeholder="206022"
              onChange={(e) => setNo(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && found && !bad && boardBox.current?.focus()}
            />
          </label>
        )}
        {found && !bad ? (
          <div className="seal-found">
            <SealPill seal={found} />
            <span>{data.names.get(found.technicianId ?? '') ?? 'في المخزن'}</span>
            {batch && <span className="muted">· دفعة {ordinalWord(batch.batchNo)} · صُرف {dayLabel(found.issuedOn)}</span>}
          </div>
        ) : bad ? (
          <div className="seal-found" data-bad>{bad}</div>
        ) : null}

        <div className="chips" role="radiogroup" aria-label="ما صار للختم">
          {outcomes.map((o) => (
            <Chip key={o.value} pressed={status === o.value} onClick={() => setStatus(o.value)}>{o.label}</Chip>
          ))}
        </div>

        <label className="field">
          <span className="label">{status === 'used' ? 'تاريخ التركيب' : 'التاريخ'}</span>
          <input type="date" className="input" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>

        {status === 'used' ? (
          <>
            <SubscriberField label="اسم المشترك (اختياري) · اكتب اسمين وبيطلع الطبلون" value={subscriber} onChange={setSubscriber} onPick={(x) => { if (x.b) setBoard(x.b) }} placeholder="مثل: محمد أحمد" />
            <label className="seal-field">
              <span className="label">رقم الطبلون</span>
              <input ref={boardBox} value={board} placeholder="361" onChange={(e) => setBoard(e.target.value)} />
            </label>
            <div className="field">
              <span className="label">العمل</span>
              <div className="work-chips">
                {WORK_CHOICES.map((w) => (
                  <Chip key={w} pressed={workParts(work).includes(w)} onClick={() => setWork(toggleWork(work, w))}>{w}</Chip>
                ))}
              </div>
              <input className="input" value={work} placeholder="اضغط أكثر من عمل، أو اكتب العمل" onChange={(e) => setWork(e.target.value)} />
            </div>
            {line && <div className="details-preview">{line}</div>}
          </>
        ) : (
          <TextField label="ملاحظة (اختياري)" value={work} onChange={setWork} placeholder={status === 'damaged' ? 'تالف' : 'ضائع'} />
        )}
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  )
}

// A seal can carry several jobs: the chips add and remove them from one line («تفتيش + إعادة شبك»).
const workParts = (work: string) => work.split(/\s*\+\s*/).map((p) => p.trim()).filter(Boolean)
const toggleWork = (work: string, w: string) => {
  const parts = workParts(work)
  return (parts.includes(w) ? parts.filter((p) => p !== w) : [...parts, w]).join(' + ')
}

// ---------- Her two Excel files, once ----------
export function ImportDialog({ onClose }: { onClose(): void }) {
  const toast = useToast()
  const [issueFile, setIssueFile] = useState<File | null>(null)
  const [usageFile, setUsageFile] = useState<File | null>(null)
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function analyse() {
    if (!issueFile) return
    setBusy(true)
    setError(null)
    try {
      const { default: ExcelJS } = await import('exceljs')
      const issue = await parseIssueWorkbook(ExcelJS, await issueFile.arrayBuffer())
      const usage = usageFile ? await parseUsageWorkbook(ExcelJS, await usageFile.arrayBuffer()) : { rows: [], repeated: 0, order: {} as Record<string, number[]>, fills: {} as Record<string, string[]> }
      setPlan(planImport(issue.rolls, usage.rows, issue.suspicious, usage.order, usage.fills))
    } catch {
      setError('تعذّرت قراءة الملف. تأكد أنه ملف Excel (xlsx) سليم.')
    }
    setBusy(false)
  }

  async function run() {
    if (!plan) return
    setBusy(true)
    setError(null)
    const lines: string[] = []
    const push = (l: string) => {
      lines.push(l)
      setLog([...lines])
    }
    try {
      const ids = new Map<string, string>()
      for (const name of plan.technicians) ids.set(name, await importTechnician(name))
      // The usage file's sheet names (often a first name): matched to the same people, and kept for the export.
      for (const sheet of plan.usageSheets) await importTechnician(sheet, sheet)
      push(`الفنيون: ${plan.technicians.length} (من لم يكن بالنظام أُضيف موقوفاً ليبقى اسمه في السجل)`)
      let i = 0
      for (const roll of plan.rolls) {
        i++
        const res = await importRoll(rollPayload(roll, (n) => ids.get(n)!))
        push(res.skipped ? `الرول ${roll.from}: موجود من قبل، تخطّيته (${i}/${plan.rolls.length})` : `الرول ${roll.from}: ${res.batches} دفعات (${i}/${plan.rolls.length})`)
      }
      // What became of each seal, once every roll and batch is in.
      let used = 0
      for (let k = 0; k < plan.usage.length; k += 400) used += await importUsage(usagePayload(plan.usage.slice(k, k + 400)))
      push(`سُجّل استخدام ${used} ختم`)
      await refreshSeals()
      setDone(true)
      toast('تم استيراد الملفات')
    } catch (e) {
      setError(sealErrorText(e))
    }
    setBusy(false)
  }

  return (
    <Dialog
      className="seal-dialog"
      open
      onClose={onClose}
      title="استيراد ملفات Excel القديمة"
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>تم</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>إلغاء</Button>
            {plan ? (
              <Button variant="primary" icon={<Upload size={17} />} busy={busy} onClick={() => void run()}>استيراد الآن</Button>
            ) : (
              <Button variant="primary" busy={busy} disabled={!issueFile} onClick={() => void analyse()}>قراءة الملفات</Button>
            )}
          </>
        )
      }
    >
      <div className="import-box">
        {!plan && (
          <>
            <label className="import-file">
              <b><FileSpreadsheet size={16} className="inline-ico" /> ملف الصرف («اختام جديد»)</b>
              <input type="file" accept=".xlsx" onChange={(e) => setIssueFile(e.target.files?.[0] ?? null)} />
            </label>
            <label className="import-file">
              <b><FileSpreadsheet size={16} className="inline-ico" /> ملف الاستخدام («اختام متفرقة»)، اختياري</b>
              <input type="file" accept=".xlsx" onChange={(e) => setUsageFile(e.target.files?.[0] ?? null)} />
            </label>
            <p className="field-hint">يُقرأ الملفان على جهازك ثم يدخلان النظام. الاستيراد آمن لو أعدته: الرول الموجود يُتخطّى.</p>
          </>
        )}
        {plan && !done && (
          <>
            <div className="import-sum">
              <div><b className="num">{plan.totals.rolls}</b><span>رول</span></div>
              <div><b className="num">{plan.totals.batches}</b><span>دفعة</span></div>
              <div><b className="num">{plan.totals.seals}</b><span>ختم مصروف</span></div>
              <div><b className="num">{plan.totals.usage}</b><span>سطر استخدام</span></div>
            </div>
            <p className="field-hint">الفنيون: {plan.technicians.join('، ')}. من ليس بالنظام يُضاف «موقوفاً».</p>
            {plan.stray.length > 0 && <p className="field-hint">{plan.stray.length} سطر استخدام رقمه ليس من أي رول، سيُتجاهل.</p>}
            {plan.fixed.length > 0 && <p className="field-hint">صُحّح تلقائياً (رقم ناقص خانة): {plan.fixed.map((f) => `${f.typed} ← ${f.now}`).join('، ')}</p>}
            {plan.unresolved.length > 0 && <p className="field-hint">تحتاج مراجعة بعد الاستيراد: {plan.unresolved.map((s) => `${s.no} (${s.tech})`).join('، ')}</p>}
          </>
        )}
        {log.length > 0 && <div className="import-log">{log.map((l, i) => <span key={i}>{l}</span>)}</div>}
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  )
}

// ---------- Changing a batch: who has it, and which day ----------
export function EditBatchDialog({ batch, data, onClose }: { batch: SealBatch; data: SealData; onClose(): void }) {
  const toast = useToast()
  const technicians = useTechnicians()
  const [tech, setTech] = useState<string | null>(batch.technicianId)
  const [date, setDate] = useState(batch.issuedOn)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // New seals for this same batch: from its own roll, typed the same way as when issuing.
  const roll = data.rolls.find((r) => r.id === batch.rollId) ?? null
  const prefix = roll ? rollPrefix(roll) : ''
  const [text, setText] = useState(prefix)
  // Seals taken out of this batch (back to the stock) when she presses save; tap again to keep one.
  const [removed, setRemoved] = useState<Set<number>>(new Set())
  const inBatch = useMemo(() => data.seals.filter((s) => s.batchId === batch.id).sort((a, b) => (a.batchPos ?? 0) - (b.batchPos ?? 0)), [data.seals, batch.id])
  const flip = (no: number) => setRemoved((r) => { const n = new Set(r); if (n.has(no)) n.delete(no); else n.add(no); return n })
  const bySeal = useMemo(() => new Map(data.seals.map((s) => [s.sealNo, s])), [data.seals])
  const parsed = useMemo(() => parseSealNumbers(withoutPendingStart(text, prefix)), [text, prefix])
  const numbers = parsed.numbers.map((n) => (roll && n < roll.fromNo && n % 100 === 0 && n + 100 <= roll.toNo ? n + 100 : n))
  const rows = numbers.map((n) => {
    const s = bySeal.get(n)
    const bad = !s ? 'غير موجود' : s.rollId !== batch.rollId ? 'من رول آخر' : s.status !== 'in_stock' ? sealStatusInfo[s.status].label : null
    return { n, s, bad }
  })
  const addOk = rows.every((r) => !r.bad) && parsed.bad.length === 0
  // A number the screen does not know may belong to something added a moment ago: look again.
  const unknown = rows.some((r) => !r.s)
  useEffect(() => {
    if (unknown) void refreshSeals(true)
  }, [unknown, rows.length])
  // A person no longer active still shows, so the batch keeps its name.
  const list = !batch.technicianId || technicians.some((t) => t.id === batch.technicianId) ? technicians : [{ id: batch.technicianId, fullName: data.names.get(batch.technicianId) ?? '—' }, ...technicians]

  async function save() {
    setBusy(true)
    setError(null)
    try {
      if (!addOk) { setBusy(false); return }
      if (tech && (tech !== batch.technicianId || date !== batch.issuedOn)) await updateBatch(batch.id, tech, date)
      if (removed.size > 0) await returnToStock([...removed])
      if (rows.length > 0) await addToBatch(batch.id, numbers)
      const parts = [rows.length > 0 ? `أُضيف ${rows.length}` : '', removed.size > 0 ? `رجع للمخزن ${removed.size}` : ''].filter(Boolean)
      toast(parts.length ? `عُدّلت الدفعة: ${parts.join('، ')}` : 'عُدّلت الدفعة')
      onClose()
    } catch (e) {
      setError(sealErrorText(e))
      setBusy(false)
    }
  }

  const aside = (
    <SummaryAside
      title="ملخص التعديل"
      bigLabel="الفني"
      big={list.find((t) => t.id === tech)?.fullName ?? 'بدون اسم'}
      rows={[['الدفعة', ordinalWord(batch.batchNo)], ['التاريخ', dayLabel(date)], ['أختام الدفعة', <span className="num">{inBatch.length - removed.size + rows.length}</span>]]}
      more={[['يُضاف', <span className="num">{rows.length}</span>], ['يُحذف', <span className="num">{removed.size}</span>]]}
    />
  )

  return (
    <Dialog
      className="seal-dialog"
      open
      onClose={onClose}
      title={`تعديل الدفعة ${ordinalWord(batch.batchNo)}`}
      subtitle="غيّر الفني أو التاريخ، أضف أختام أو احذفها."
      icon={<Stamp size={20} />}
      aside={aside}
      footer={
        <>
          <FootHint />
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button variant="primary" busy={busy} disabled={!addOk} onClick={() => void save()}>حفظ</Button>
        </>
      }
    >
      <div className="issue-form" onKeyDown={saveOnCtrlEnter(() => void save())}>
        <div className="field">
          <span className="label">الفني</span>
          <div className="chips">
            {list.map((t) => <Chip key={t.id} pressed={tech === t.id} onClick={() => setTech(t.id)}>{t.fullName}</Chip>)}
          </div>
        </div>
        <label className="field">
          <span className="label">تاريخ الصرف</span>
          <input type="date" className="input" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {inBatch.length > 0 && (
          <div className="field">
            <span className="label">أختام الدفعة (اضغط على الختم لحذفه من الدفعة)</span>
            <div className="parsed">
              {inBatch.map((s) => {
                const out = removed.has(s.sealNo)
                const locked = s.status !== 'issued'
                return (
                  <button
                    key={s.sealNo}
                    type="button"
                    className="seal-pill"
                    data-status={s.status}
                    data-bad={out ? true : undefined}
                    disabled={locked}
                    aria-pressed={out}
                    title={locked ? 'ختم مستخدم، ما بينحذف من هون' : out ? 'سيُحذف، اضغط للتراجع' : 'اضغط للحذف'}
                    onClick={() => flip(s.sealNo)}
                    style={out ? { textDecoration: 'line-through', opacity: 0.7 } : undefined}
                  >
                    <i aria-hidden="true" />
                    <span className="num">{s.sealNo}</span>
                    <small>{out ? 'سيُحذف' : locked ? 'مستخدم' : '✕'}</small>
                  </button>
                )
              })}
            </div>
          </div>
        )}
        <label className="field">
          <span className="label">
            إضافة أختام جديدة للدفعة{roll ? <> (من الرول <b className="num">{roll.fromNo}–{roll.toNo}</b>). أول الرقم <b className="num roll-fixed">{prefix}</b> جاهز، وكل ما تضغط <b>مسافة</b> بيجيك من جديد</> : ''}
          </span>
          <textarea
            className="seal-input"
            dir="ltr"
            value={text}
            placeholder={`${prefix}02 ${prefix}35 …`}
            onChange={(e) => setText(continueAfterSeparator(text, e.target.value, prefix, e.target.selectionStart === e.target.value.length))}
          />
        </label>
        {(rows.length > 0 || parsed.bad.length > 0) && (
          <div className="parsed" aria-live="polite">
            {rows.map((r) => (
              <span key={r.n} className="seal-pill" data-status={r.s?.status ?? 'lost'} data-bad={r.bad ? true : undefined}>
                <i aria-hidden="true" />
                <span className="num">{r.n}</span>
                {r.bad && <small>{r.bad}</small>}
              </span>
            ))}
            {parsed.bad.map((b) => (
              <span key={b} className="seal-pill" data-status="lost" data-bad><i aria-hidden="true" /><span className="num">{b}</span><small>رقم غير صحيح</small></span>
            ))}
          </div>
        )}
        <p className="field-hint">الفني والتاريخ يتغيّران لكل أختام الدفعة، والأختام الجديدة تلتحق بها. تقدر ترجع تعدّلها وتضيف أكثر. لتغيير ختم بعينه افتحه من «سجل الأختام».</p>
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  )
}

// ---------- Changing a roll: its receiving day and note ----------
export function EditRollDialog({ roll, onClose }: { roll: SealRoll; onClose(): void }) {
  const toast = useToast()
  const [date, setDate] = useState(roll.receivedOn)
  const [note, setNote] = useState(roll.note)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await updateRoll(roll.id, date, note)
      toast('عُدّل الرول')
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
      title={`تعديل الرول ${roll.fromNo} - ${roll.toNo}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>حفظ</Button>
        </>
      }
    >
      <div className="issue-form">
        <label className="field">
          <span className="label">تاريخ الاستلام</span>
          <input type="date" className="input" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <TextField label="ملاحظة" value={note} onChange={setNote} />
        <p className="field-hint">أرقام الرول نفسها لا تتغيّر. إن سجّلتها غلط، احذف الرول (وهو فاضي) وسجّله من جديد.</p>
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  )
}
