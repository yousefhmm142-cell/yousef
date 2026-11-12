import { Check,Stamp } from 'lucide-react'
import { FootHint,SummaryAside,saveOnCtrlEnter } from '../../ui/SummaryAside'
import { useEffect,useRef,useState } from 'react'
import { todayISO } from '../../lib/dates'
import { Dialog } from '../../ui/Dialog'
import { Chip,TextField } from '../../ui/form'
import { Button } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { useConfirm } from '../../ui/Confirm'
import { SubscriberField } from '../tasks/SubscriberField'
import { recordSeal,returnToStock,sealErrorText } from './repo'
import { composeDetails,ordinalWord,parseSealNumbers,splitDetails,WORK_CHOICES,type Seal,type SealData, previousOnBoard } from './model'
import { SealHistoryButton } from './SealHistory'
import { dayLabel,SealPill } from './parts'

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
            {(() => {
              // Information only: a seal on this board before (the new one usually replaces it).
              const before = previousOnBoard(data.seals, board, found?.sealNo)
              const last = before[0]
              return last ? (
                <p className="seal-prev" role="status">
                  على هالطبلون ختم سابق <b className="num">{last.sealNo}</b>{last.usedOn ? <> من <span className="num">{dayLabel(last.usedOn)}</span></> : null}
                  {last.technicianId ? ` (${data.names.get(last.technicianId) ?? '—'})` : ''}
                  {before.length > 1 && <> و{before.length - 1} قبله</>}
                </p>
              ) : null
            })()}
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
