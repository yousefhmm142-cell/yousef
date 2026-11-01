import { FileSpreadsheet, Pencil, Plus, Printer, Stamp, Trash2, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useEmployee } from '../../auth/AuthProvider'
import { isDemo } from '../../config'
import { todayISO } from '../../lib/dates'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { Button } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { isManagerRole } from '../../types'
import { useConfirmTap } from '../sheets/useDraft'
import { EditBatchDialog, EditRollDialog, ImportDialog, IssueDialog, NewRollDialog } from './dialogs'
import { downloadIssueLog } from './excel'
import { ordinalWord, rollStats, totals, type SealBatch, type SealData, type SealRoll } from './model'
import { dayLabel, SealPill, SealsTabs, StackBar, TechNav } from './parts'
import { deleteBatch, deleteRoll, refreshSeals, sealErrorText, useSealData, useSealsLive } from './repo'
import { SealSlips } from './SealSlips'

/** Page 1: the rolls and their balance, and handing batches of seals to technicians. */
export function SealIssuePage() {
  useDocumentTitle('صرف الأختام')
  useSealsLive()
  const me = useEmployee()
  const toast = useToast()
  const data = useSealData()
  const [dialog, setDialog] = useState<'roll' | 'issue' | 'import' | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const [slips, setSlips] = useState<SealBatch[] | null>(null)
  const [exporting, setExporting] = useState(false)
  const [tech, setTech] = useState<string | null>(null)
  const [editBatch, setEditBatch] = useState<SealBatch | null>(null)
  const [editRoll, setEditRoll] = useState<SealRoll | null>(null)

  const sum = useMemo(() => totals(data?.seals ?? []), [data?.seals])
  const days = useMemo(() => {
    const map = new Map<string, SealBatch[]>()
    for (const b of [...(data?.batches ?? [])].filter((x) => !tech || x.technicianId === tech).sort((a, c) => c.issuedOn.localeCompare(a.issuedOn) || c.batchNo - a.batchNo)) (map.get(b.issuedOn) ?? map.set(b.issuedOn, []).get(b.issuedOn)!).push(b)
    return [...map.entries()].slice(0, 14)
  }, [data?.batches, tech])

  if (isDemo) return <div className="empty card"><h3>الأختام تعمل على قاعدة البيانات الحقيقية</h3><p>هذه الصفحة غير متاحة في وضع التجربة.</p></div>
  if (!data) return <div className="loading-block" aria-busy="true" />

  async function exportExcel() {
    if (!data) return
    setExporting(true)
    try {
      // Always from what the system holds right now.
      await refreshSeals()
      await downloadIssueLog(data)
      toast('نُزّل ملف الصرف')
    } catch {
      toast('تعذّر تجهيز الملف', 'danger')
    }
    setExporting(false)
  }

  function print(list: SealBatch[]) {
    setSlips(list)
    // Once the slips are drawn, open the print window.
    window.setTimeout(() => window.print(), 150)
  }

  const todays = data.batches.filter((b) => b.issuedOn === todayISO())

  return (
    <div className="seals">
      <header className="ph">
        <div>
          <h1>الأختام</h1>
          <p className="muted">سجّل رولات الأختام، واصرف لكل فني دفعته. كل شيء يُحفظ هنا لحاله، ومنه يُصدَّر ملف Excel.</p>
        </div>
        <div className="ph-actions">
          <Button variant="secondary" icon={<FileSpreadsheet size={17} />} busy={exporting} onClick={() => void exportExcel()}>تصدير Excel</Button>
          {isManagerRole(me.role) && <Button variant="ghost" icon={<Upload size={17} />} onClick={() => setDialog('import')}>استيراد من Excel</Button>}
          <Button variant="secondary" icon={<Plus size={17} />} onClick={() => setDialog('roll')}>رول جديد</Button>
          <Button variant="primary" icon={<Stamp size={17} />} disabled={!data.rolls.length} onClick={() => setDialog('issue')}>صرف دفعة</Button>
        </div>
      </header>

      <SealsTabs />

      <div className="kpis">
        <div className="kpi hero"><div className="kpi-label">في المخزن</div><div className="kpi-value num">{sum.inStock}<small>ختم</small></div><div className="kpi-sub">جاهزة للصرف</div></div>
        <div className="kpi glass"><div className="kpi-label">عند الفنيين</div><div className="kpi-value num">{sum.issued}</div><div className="kpi-sub">لم تُستخدم بعد</div></div>
        <div className="kpi glass"><div className="kpi-label">مستخدمة</div><div className="kpi-value num">{sum.used}</div><div className="kpi-sub">مسجّلة بتفاصيلها</div></div>
        <div className="kpi glass"><div className="kpi-label">تالفة أو ضائعة</div><div className="kpi-value num">{sum.damaged + sum.lost}</div><div className="kpi-sub">{sum.lost ? `${sum.lost} ضائع` : 'خارج المخزن'}</div></div>
      </div>

      {data.rolls.length === 0 ? (
        <section className="empty card">
          <span className="halo"><Stamp size={30} /></span>
          <h3>ابدأ بتسجيل أول رول</h3>
          <p>اكتب رقم أول ختم في الرول، وآخر ختم (أو اتركه فاضي: 100 ختم). وإن عندك ملفاتك القديمة، استوردها.</p>
          <div className="ph-actions" style={{ justifyContent: 'center' }}>
            <Button variant="primary" icon={<Plus size={17} />} onClick={() => setDialog('roll')}>رول جديد</Button>
            {isManagerRole(me.role) && <Button variant="secondary" icon={<Upload size={17} />} onClick={() => setDialog('import')}>استيراد من Excel</Button>}
          </div>
        </section>
      ) : (
        <section className="roll-grid" aria-label="الرولات">
          {data.rolls.map((r) => {
            const st = rollStats(r, data.seals, data.batches)
            return (
              <article key={r.id} className="roll-card card">
                <div className="roll-no num">{r.fromNo}<small>←</small>{r.toNo}</div>
                <div className="roll-meta"><span>استُلم {dayLabel(r.receivedOn)}</span><span className="num">{st.batches} دفعات</span>{r.note && <span>{r.note}</span>}</div>
                <StackBar parts={[{ status: 'used', n: st.used }, { status: 'issued', n: st.issued }, { status: 'bad', n: st.damaged + st.lost }, { status: 'in_stock', n: st.inStock }]} />
                <div className="roll-nums">
                  <div><b className="num">{st.inStock}</b><span>مخزن</span></div>
                  <div className="n-issued"><b className="num">{st.issued}</b><span>عند الفني</span></div>
                  <div className="n-used"><b className="num">{st.used}</b><span>مستخدم</span></div>
                  <div className="n-bad"><b className="num">{st.damaged + st.lost}</b><span>تالف</span></div>
                </div>
                <RollActions rollId={r.id} canDelete={st.inStock === st.total} disabled={st.inStock === 0} onIssue={() => setDialog('issue')} onEdit={() => setEditRoll(r)} />
              </article>
            )
          })}
        </section>
      )}

      {data.batches.length > 0 && (
        <div className="seals-layout">
          <TechNav data={data} value={tech} onChange={setTech} />
          <section className="seals-main" aria-label="آخر الصرف">
            <div className="ph-actions" style={{ marginInlineStart: 0, justifyContent: 'space-between', width: '100%' }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{tech ? `دفعات ${data.names.get(tech) ?? ''}` : 'آخر ما صُرف'}</h2>
              <select className="select tech-select" aria-label="الفني" value={tech ?? ''} onChange={(e) => setTech(e.target.value || null)}>
                <option value="">كل الفنيين</option>
                {[...new Set(data.batches.map((b) => b.technicianId))].map((id) => <option key={id} value={id}>{data.names.get(id) ?? '—'}</option>)}
              </select>
              {todays.length > 0 && <Button variant="ghost" icon={<Printer size={16} />} onClick={() => print(todays)}>طباعة أوراق صرف اليوم</Button>}
            </div>
            {days.length === 0 && <p className="card-empty">لا دفعات لهذا الفني.</p>}
            {days.map(([day, list]) => (
              <div key={day} className="batch-day">
                <h3>{day === todayISO() ? 'اليوم' : dayLabel(day)}</h3>
                {list.map((b) => (
                  <BatchCard key={b.id} data={data} batch={b} fresh={fresh === b.id} onPrint={() => print([b])} onEdit={() => setEditBatch(b)} onDeleted={() => toast('حُذفت الدفعة، ورجعت أختامها للمخزن')} />
                ))}
              </div>
            ))}
          </section>
        </div>
      )}

      {editBatch && <EditBatchDialog batch={editBatch} data={data} onClose={() => setEditBatch(null)} />}
      {editRoll && <EditRollDialog roll={editRoll} onClose={() => setEditRoll(null)} />}
      {dialog === 'roll' && <NewRollDialog onClose={() => setDialog(null)} />}
      {dialog === 'issue' && <IssueDialog data={data} onClose={() => setDialog(null)} onDone={setFresh} />}
      {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} />}
      {slips && <SealSlips data={data} batches={slips} />}
    </div>
  )
}

function RollActions({ rollId, canDelete, disabled, onIssue, onEdit }: { rollId: string; canDelete: boolean; disabled: boolean; onIssue(): void; onEdit(): void }) {
  const toast = useToast()
  const [armed, arm, reset] = useConfirmTap()
  return (
    <div className="roll-actions">
      <Button variant="primary" disabled={disabled} onClick={onIssue}>صرف دفعة</Button>
      <Button variant="ghost" icon={<Pencil size={15} />} onClick={onEdit}>تعديل</Button>
      {canDelete && (
        <Button
          variant="ghost"
         
          icon={<Trash2 size={15} />}
          onClick={async () => {
            if (!armed) return arm()
            reset()
            try {
              await deleteRoll(rollId)
              toast('حُذف الرول')
            } catch (e) {
              toast(sealErrorText(e), 'danger')
            }
          }}
        >
          {armed ? 'اضغط للتأكيد' : 'حذف'}
        </Button>
      )}
    </div>
  )
}

function BatchCard({ data, batch, fresh, onPrint, onEdit, onDeleted }: { data: SealData; batch: SealBatch; fresh: boolean; onPrint(): void; onEdit(): void; onDeleted(): void }) {
  const toast = useToast()
  const [armed, arm, reset] = useConfirmTap()
  const seals = data.seals.filter((s) => s.batchId === batch.id).sort((a, b) => (a.batchPos ?? 0) - (b.batchPos ?? 0))
  const roll = data.rolls.find((r) => r.id === batch.rollId)
  const used = seals.filter((s) => s.status === 'used').length
  return (
    <article className="batch-card card" data-fresh={fresh || undefined}>
      <div className="batch-head">
        <b>الدفعة {ordinalWord(batch.batchNo)}</b>
        <span className="tech">{data.names.get(batch.technicianId) ?? '—'}</span>
        <span className="muted num">{roll ? `${roll.fromNo}–${roll.toNo}` : ''} · {used}/{seals.length} مستخدم</span>
        <span className="grow" />
        <Button variant="ghost" icon={<Printer size={15} />} onClick={onPrint}>ورقة الصرف</Button>
        <Button variant="ghost" icon={<Pencil size={15} />} onClick={onEdit}>تعديل</Button>
        <Button
          variant="ghost"
          icon={<Trash2 size={15} />}
          onClick={async () => {
            if (!armed) return arm()
            reset()
            try {
              await deleteBatch(batch.id)
              onDeleted()
            } catch (e) {
              toast(sealErrorText(e), 'danger')
            }
          }}
        >
          {armed ? (used ? `يمسح تسجيل ${used} ختم، اضغط للتأكيد` : 'اضغط للتأكيد') : 'حذف'}
        </Button>
      </div>
      <div className="batch-strip">
        {seals.map((s) => <SealPill key={s.sealNo} seal={s} />)}
      </div>
    </article>
  )
}
