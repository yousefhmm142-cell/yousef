import { Check, FileSpreadsheet, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { todayISO } from '../../lib/dates'
import { Dialog } from '../../ui/Dialog'
import { Chip, TextField } from '../../ui/form'
import { Button } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { addRoll, importRoll, importTechnician, importUsage, issueBatch, recordSeal, refreshSeals, returnToStock, sealErrorText, updateBatch, updateRoll, useTechnicians } from './repo'
import { parseIssueWorkbook, parseUsageWorkbook, planImport, rollPayload, usagePayload, type ImportPlan } from './import'
import { composeDetails, latinDigits, ordinalWord, parseSealNumbers, sealStatusInfo, splitDetails, WORK_CHOICES, type Seal, type SealBatch, type SealData, type SealRoll } from './model'
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

// ---------- Handing a batch to a technician ----------
export function IssueDialog({ data, onClose, onDone, preset }: { data: SealData; onClose(): void; onDone(batchId: string): void; preset?: { rollId?: string } }) {
  const toast = useToast()
  const technicians = useTechnicians()
  const [tech, setTech] = useState<string | null>(null)
  const [date, setDate] = useState(todayISO())
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)

  const bySeal = useMemo(() => new Map(data.seals.map((s) => [s.sealNo, s])), [data.seals])
  const parsed = useMemo(() => parseSealNumbers(text), [text])
  const rows = parsed.numbers.map((n) => {
    const s = bySeal.get(n)
    const bad = !s ? 'غير موجود' : s.status !== 'in_stock' ? sealStatusInfo[s.status].label : null
    return { n, s, bad }
  })
  const rolls = new Set(rows.flatMap((r) => (r.s ? [r.s.rollId] : [])))
  const mixed = rolls.size > 1
  const rollOf = (id: string) => data.rolls.find((r) => r.id === id)
  const ok = rows.length > 0 && rows.every((r) => !r.bad) && !mixed && parsed.bad.length === 0 && tech !== null
  const rollInfo = rolls.size === 1 ? rollOf([...rolls][0]!) : null

  useEffect(() => {
    area.current?.focus()
  }, [])
  void preset

  async function submit(again: boolean) {
    if (!ok || !tech) return
    setBusy(true)
    setError(null)
    try {
      const res = await issueBatch(tech, date, parsed.numbers)
      toast(`صُرفت دفعة ${ordinalWord(res.batch_no)} (${res.count} أختام)`)
      onDone(res.batch_id)
      if (again) {
        setText('')
        setBusy(false)
        area.current?.focus()
      } else onClose()
    } catch (e) {
      setError(sealErrorText(e))
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="صرف دفعة أختام لفني"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button variant="secondary" disabled={!ok} busy={busy} onClick={() => void submit(true)}>صرف وإضافة دفعة أخرى</Button>
          <Button variant="primary" icon={<Check size={17} />} disabled={!ok} busy={busy} onClick={() => void submit(false)}>
            {ok ? `صرف ${rows.length} ${rows.length > 10 ? 'ختماً' : 'أختام'}` : 'صرف'}
          </Button>
        </>
      }
    >
      <div className="issue-form">
        <div className="field">
          <span className="label">الفني</span>
          <div className="chips">
            {technicians.map((t) => (
              <Chip key={t.id} pressed={tech === t.id} onClick={() => setTech(t.id)}>{t.fullName}</Chip>
            ))}
          </div>
        </div>
        <label className="field">
          <span className="label">اليوم (اليوم تلقائياً)</span>
          <input type="date" className="input" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">أرقام الأختام: اكتبها أو الصقها، وحروف WK تُتجاهل</span>
          <textarea
            ref={area}
            className="seal-input"
            value={text}
            placeholder="181365 181388 181355 ..."
            onChange={(e) => setText(e.target.value)}
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
          <span>{mixed ? 'الأرقام من أكثر من رول، اصرف كل رول لحاله' : rollInfo ? `من الرول ${rollInfo.fromNo} - ${rollInfo.toNo}` : 'عدد الأختام'}</span>
          <b className="num">{rows.length}</b>
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
  const bad = typed && !found ? 'هذا الرقم غير موجود في أي رول مسجّل.' : found && !found.technicianId && status === 'used' ? 'هذا الختم لم يُصرف لفني بعد.' : null
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
  // Undo the record, or take the seal back to the stock: asks once more before doing it.
  const [confirm, setConfirm] = useState<'undo' | 'stock' | null>(null)
  useEffect(() => {
    if (!confirm) return
    const id = window.setTimeout(() => setConfirm(null), 4000)
    return () => window.clearTimeout(id)
  }, [confirm])
  const recorded = !!seal && seal.status !== 'in_stock' && seal.status !== 'issued'
  async function undo(kind: 'undo' | 'stock') {
    if (!seal) return
    if (confirm !== kind) return setConfirm(kind)
    setBusy(true)
    try {
      if (kind === 'undo') await recordSeal(seal.sealNo, 'issued', null, '')
      else await returnToStock([seal.sealNo])
      toast(kind === 'undo' ? `أُلغي تسجيل الختم ${seal.sealNo}` : `رجع الختم ${seal.sealNo} للمخزن`)
      onClose()
    } catch (e) {
      setError(sealErrorText(e))
      setBusy(false)
      setConfirm(null)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={seal ? `الختم ${seal.sealNo}` : 'تسجيل استخدام ختم'}
      footer={
        <>
          {seal && recorded && <Button variant="ghost" disabled={busy} onClick={() => void undo('undo')}>{confirm === 'undo' ? 'اضغط للتأكيد' : 'إلغاء التسجيل'}</Button>}
          {seal && seal.status !== 'in_stock' && <Button variant="ghost" disabled={busy} onClick={() => void undo('stock')}>{confirm === 'stock' ? 'اضغط للتأكيد' : 'إرجاع للمخزن'}</Button>}
          <Button variant="ghost" onClick={onClose}>إغلاق</Button>
          {!seal && <Button variant="secondary" disabled={!ready} busy={busy} onClick={() => void save(true)}>حفظ والتالي</Button>}
          <Button variant="primary" icon={<Check size={17} />} disabled={!ready} busy={busy} onClick={() => void save(false)}>حفظ</Button>
        </>
      }
    >
      <div className="issue-form">
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
            <label className="seal-field">
              <span className="label">رقم الطبلون</span>
              <input ref={boardBox} value={board} placeholder="361" onChange={(e) => setBoard(e.target.value)} />
            </label>
            <div className="field">
              <span className="label">العمل</span>
              <div className="work-chips">
                {WORK_CHOICES.map((w) => (
                  <Chip key={w} pressed={work === w} onClick={() => setWork(work === w ? '' : w)}>{w}</Chip>
                ))}
              </div>
              <input className="input" value={work} placeholder="أو اكتب العمل" onChange={(e) => setWork(e.target.value)} />
            </div>
            <TextField label="اسم المشترك (اختياري)" value={subscriber} onChange={setSubscriber} />
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
      const usage = usageFile ? await parseUsageWorkbook(ExcelJS, await usageFile.arrayBuffer()) : { rows: [], repeated: 0, order: {} as Record<string, number[]> }
      setPlan(planImport(issue.rolls, usage.rows, issue.suspicious, usage.order))
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
  const [tech, setTech] = useState(batch.technicianId)
  const [date, setDate] = useState(batch.issuedOn)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A person no longer active still shows, so the batch keeps its name.
  const list = technicians.some((t) => t.id === batch.technicianId) ? technicians : [{ id: batch.technicianId, fullName: data.names.get(batch.technicianId) ?? '—' }, ...technicians]

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await updateBatch(batch.id, tech, date)
      toast('عُدّلت الدفعة')
      onClose()
    } catch (e) {
      setError(sealErrorText(e))
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`تعديل الدفعة ${ordinalWord(batch.batchNo)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>حفظ</Button>
        </>
      }
    >
      <div className="issue-form">
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
        <p className="field-hint">يتغيّر الفني والتاريخ لكل أختام الدفعة. لتغيير ختم بعينه افتحه من «سجل الأختام».</p>
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
