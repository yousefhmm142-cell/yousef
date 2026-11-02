import { FileSpreadsheet, Pencil, Plus, Stamp, Trash2, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useEmployee } from '../../auth/AuthProvider'
import { isDemo } from '../../config'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { Button } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { isManagerRole } from '../../types'
import { useConfirm } from '../../ui/Confirm'
import { AssignDialog, EditRollDialog, ImportDialog, IssueDialog, NewRollDialog } from './dialogs'
import { downloadIssueLog } from './excel'
import { ordinalWord, rollStats, totals, type SealBatch, type SealRoll } from './model'
import { dayLabel, SealsLoading, SealsTabs, StackBar } from './parts'
import { deleteRoll, refreshSeals, sealErrorText, useSealData, useSealsLive, useSealsReady } from './repo'

/** Page 1: the rolls and their balance, and handing batches of seals to technicians. */
export function SealIssuePage() {
  useDocumentTitle('صرف الأختام')
  useSealsLive()
  const ready = useSealsReady()
  const me = useEmployee()
  const toast = useToast()
  const data = useSealData()
  const [dialog, setDialog] = useState<'roll' | 'issue' | 'import' | null>(null)
  /** The roll whose own «تجهيز دفعة» was pressed; none when the big button at the top was. */
  const [issueRoll, setIssueRoll] = useState<string | null>(null)
  const [, setFresh] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [editRoll, setEditRoll] = useState<SealRoll | null>(null)
  const [assign, setAssign] = useState<SealBatch | null>(null)

  const sum = useMemo(() => totals(data?.seals ?? []), [data?.seals])
  if (isDemo) return <div className="empty card"><h3>الأختام تعمل على قاعدة البيانات الحقيقية</h3><p>هذه الصفحة غير متاحة في وضع التجربة.</p></div>
  if (!ready || !data) return <SealsLoading />

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
          <Button variant="primary" icon={<Stamp size={17} />} disabled={!data.rolls.length} onClick={() => { setIssueRoll(null); setDialog('issue') }}>تجهيز دفعة</Button>
        </div>
      </header>

      <SealsTabs />

      <div className="kpis">
        <div className="kpi hero"><div className="kpi-label">في المخزن</div><div className="kpi-value num">{sum.inStock}<small>ختم</small></div><div className="kpi-sub">جاهزة للصرف</div></div>
        <div className="kpi glass"><div className="kpi-label">عند الفنيين</div><div className="kpi-value num">{sum.issued}</div><div className="kpi-sub">لم تُستخدم بعد</div></div>
        <div className="kpi glass"><div className="kpi-label">مستخدمة</div><div className="kpi-value num">{sum.used}</div><div className="kpi-sub">مسجّلة بتفاصيلها</div></div>
        <div className="kpi glass"><div className="kpi-label">تالفة أو ضائعة</div><div className="kpi-value num">{sum.damaged + sum.lost}</div><div className="kpi-sub">{sum.lost ? `${sum.lost} ضائع` : 'خارج المخزن'}</div></div>
      </div>

      {data.batches.some((b) => !b.technicianId) && (
        <section className="unnamed card" aria-label="دفعات بانتظار الاسم">
          <h2>دفعات بانتظار الاسم</h2>
          <ul>
            {data.batches
              .filter((b) => !b.technicianId)
              .map((b) => {
                const roll = data.rolls.find((r) => r.id === b.rollId)
                const n = data.seals.filter((s) => s.batchId === b.id).length
                return (
                  <li key={b.id}>
                    <b>الدفعة {b.label?.trim() || ordinalWord(b.batchNo)}</b>
                    <span className="muted num">{roll ? `${roll.fromNo}–${roll.toNo}` : ''} · {n} أختام · {dayLabel(b.issuedOn)}</span>
                    <Button variant="primary" className="assign-btn" onClick={() => setAssign(b)}>تعبئة الاسم</Button>
                  </li>
                )
              })}
          </ul>
        </section>
      )}

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
                <RollActions rollId={r.id} canDelete={st.inStock === st.total} disabled={st.inStock === 0} onIssue={() => { setIssueRoll(r.id); setDialog('issue') }} onEdit={() => setEditRoll(r)} />
              </article>
            )
          })}
        </section>
      )}

      {assign && <AssignDialog batch={assign} data={data} onClose={() => setAssign(null)} />}
      {editRoll && <EditRollDialog roll={editRoll} onClose={() => setEditRoll(null)} />}
      {dialog === 'roll' && <NewRollDialog onClose={() => setDialog(null)} />}
      {dialog === 'issue' && <IssueDialog data={data} preset={issueRoll ? { rollId: issueRoll } : undefined} onClose={() => setDialog(null)} onDone={setFresh} />}
      {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} />}
    </div>
  )
}

function RollActions({ rollId, canDelete, disabled, onIssue, onEdit }: { rollId: string; canDelete: boolean; disabled: boolean; onIssue(): void; onEdit(): void }) {
  const toast = useToast()
  const confirm = useConfirm()
  return (
    <div className="roll-actions">
      <Button variant="primary" disabled={disabled} onClick={onIssue}>تجهيز دفعة</Button>
      <Button variant="ghost" icon={<Pencil size={15} />} onClick={onEdit}>تعديل</Button>
      {canDelete && (
        <Button
          variant="ghost"
         
          icon={<Trash2 size={15} />}
          onClick={async () => {
            const yes = await confirm({ title: 'حذف الرول؟', message: 'يُحذف الرول وأختامه (ما انصرف منه شي).', confirmLabel: 'حذف الرول', danger: true })
            if (!yes) return
            try {
              await deleteRoll(rollId)
              toast('حُذف الرول')
            } catch (e) {
              toast(sealErrorText(e), 'danger')
            }
          }}
        >
          حذف
        </Button>
      )}
    </div>
  )
}

