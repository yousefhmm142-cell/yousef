import { SealHistoryButton } from './SealHistory'
import { Printer } from 'lucide-react'
import { useMemo, useState } from 'react'
import { isDemo } from '../../config'
import { todayISO } from '../../lib/dates'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { Button } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { Pencil, Trash2 } from 'lucide-react'
import { useConfirm } from '../../ui/Confirm'
import { AssignDialog, EditBatchDialog } from './dialogs'
import { ordinalWord, type SealBatch, type SealData } from './model'
import { dayLabel, SealPill, SealsLoading, SealsTabs, TechNav } from './parts'
import { deleteBatch, sealErrorText, useSealData, useSealsLive, useSealsReady } from './repo'
import { SealSlips } from './SealSlips'

/** Page 2: what was handed out lately, per day. A batch with no name yet waits here for it. */
export function SealRecentPage() {
  useDocumentTitle('آخر ما صُرف')
  useSealsLive()
  const ready = useSealsReady()
  const toast = useToast()
  const data = useSealData()
  const [tech, setTech] = useState<string | null>(null)
  const [slips, setSlips] = useState<SealBatch[] | null>(null)
  const [editBatch, setEditBatch] = useState<SealBatch | null>(null)
  const [assign, setAssign] = useState<SealBatch | null>(null)

  const days = useMemo(() => {
    const map = new Map<string, SealBatch[]>()
    for (const b of [...(data?.batches ?? [])].filter((x) => !tech || x.technicianId === tech).sort((a, c) => c.issuedOn.localeCompare(a.issuedOn) || c.batchNo - a.batchNo)) (map.get(b.issuedOn) ?? map.set(b.issuedOn, []).get(b.issuedOn)!).push(b)
    return [...map.entries()].slice(0, 14)
  }, [data?.batches, tech])

  if (isDemo) return <div className="empty card"><h3>الأختام تعمل على قاعدة البيانات الحقيقية</h3><p>هذه الصفحة غير متاحة في وضع التجربة.</p></div>
  if (!ready || !data) return <SealsLoading />

  function print(list: SealBatch[]) {
    setSlips(list)
    // Once the slips are drawn, open the print window.
    window.setTimeout(() => window.print(), 150)
  }

  const todays = data.batches.filter((b) => b.issuedOn === todayISO())
  const unnamed = data.batches.filter((b) => !b.technicianId)

  return (
    <div className="seals">
      <header className="ph">
        <div>
          <h1>آخر ما صُرف</h1>
          <p className="muted">دفعات الأختام يوماً بيوم. الدفعة اللي جهّزتها بدون اسم بتظهر هنا بزر أزرق «تعبئة الاسم».</p>
        </div>
        <div className="ph-actions">
          {todays.length > 0 && <Button variant="secondary" icon={<Printer size={16} />} onClick={() => print(todays)}>طباعة أوراق صرف اليوم</Button>}
        </div>
      </header>

      <SealsTabs />

      {unnamed.length > 0 && (
        <div className="banner info" role="status">
          <p><b>{unnamed.length} {unnamed.length === 1 ? 'دفعة' : 'دفعات'}</b> بانتظار الاسم<span>اضغط «تعبئة الاسم» على الدفعة واختر الفني. ما بتقدر تسجّل استخدام ختم منها قبل ما تسمّيها.</span></p>
        </div>
      )}

      {data.batches.length === 0 ? (
        <section className="empty card"><h3>ما في دفعات بعد</h3><p>جهّز أول دفعة من صفحة «صرف الأختام».</p></section>
      ) : (
        <div className="seals-layout">
          <TechNav data={data} value={tech} onChange={setTech} />
          <section className="seals-main" aria-label="آخر الصرف">
            <div className="ph-actions" style={{ marginInlineStart: 0, justifyContent: 'space-between', width: '100%' }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{tech ? `دفعات ${data.names.get(tech) ?? ''}` : 'كل الدفعات'}</h2>
              <select className="select tech-select" aria-label="الفني" value={tech ?? ''} onChange={(e) => setTech(e.target.value || null)}>
                <option value="">كل الفنيين</option>
                {[...new Set(data.batches.flatMap((b) => (b.technicianId ? [b.technicianId] : [])))].map((id) => <option key={id} value={id}>{data.names.get(id) ?? '—'}</option>)}
              </select>
            </div>
            {days.length === 0 && <p className="card-empty">لا دفعات لهذا الفني.</p>}
            {days.map(([day, list]) => (
              <div key={day} className="batch-day">
                <h3>{day === todayISO() ? 'اليوم' : dayLabel(day)}</h3>
                {list.map((b) => (
                  <BatchCard key={b.id} data={data} batch={b} onPrint={() => print([b])} onEdit={() => setEditBatch(b)} onAssign={() => setAssign(b)} onDeleted={() => toast('حُذفت الدفعة، ورجعت أختامها للمخزن')} />
                ))}
              </div>
            ))}
          </section>
        </div>
      )}

      {editBatch && <EditBatchDialog batch={editBatch} data={data} onClose={() => setEditBatch(null)} />}
      {assign && <AssignDialog batch={assign} data={data} onClose={() => setAssign(null)} />}
      {slips && <SealSlips data={data} batches={slips} />}
    </div>
  )
}

function BatchCard({ data, batch, onPrint, onEdit, onAssign, onDeleted }: { data: SealData; batch: SealBatch; onPrint(): void; onEdit(): void; onAssign(): void; onDeleted(): void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const seals = data.seals.filter((s) => s.batchId === batch.id).sort((a, b) => (a.batchPos ?? 0) - (b.batchPos ?? 0))
  const roll = data.rolls.find((r) => r.id === batch.rollId)
  const used = seals.filter((s) => s.status === 'used').length
  return (
    <article className="batch-card card">
      <div className="batch-head">
        <b>الدفعة {batch.label?.trim() || ordinalWord(batch.batchNo)}</b>
        {batch.technicianId ? (
          <span className="tech">{data.names.get(batch.technicianId) ?? '—'}</span>
        ) : (
          <>
            <span className="tech none">بدون اسم</span>
            <Button variant="primary" className="assign-btn" onClick={onAssign}>تعبئة الاسم</Button>
          </>
        )}
        <span className="muted num">{roll ? `${roll.fromNo}–${roll.toNo}` : ''} · {used}/{seals.length} مستخدم</span>
        <span className="grow" />
        <div className="batch-actions">
        <Button variant="ghost" icon={<Printer size={15} />} onClick={onPrint}>ورقة الصرف</Button>
        <Button variant="ghost" icon={<Pencil size={15} />} onClick={onEdit}>تعديل</Button>
        <SealHistoryButton table="seal_batches" record={batch.id} label="السجل" />
        <Button
          variant="ghost"
          icon={<Trash2 size={15} />}
          onClick={async () => {
            const yes = await confirm({
              title: `حذف الدفعة ${batch.label?.trim() || ordinalWord(batch.batchNo)}؟`,
              message: used ? `ترجع أختامها للمخزن، ويُمسح تسجيل استخدام ${used} ختم فيها.` : 'ترجع أختامها للمخزن.',
              confirmLabel: 'حذف الدفعة',
              danger: true,
            })
            if (!yes) return
            try {
              await deleteBatch(batch.id)
              onDeleted()
            } catch (e) {
              toast(sealErrorText(e), 'danger')
            }
          }}
        >
          حذف
        </Button>
        </div>
      </div>
      <div className="batch-strip">
        {seals.map((s) => <SealPill key={s.sealNo} seal={s} />)}
        {!seals.length && <span className="muted">كل أختام هذه الدفعة انصرفت لدفعة أخرى</span>}
      </div>
    </article>
  )
}
