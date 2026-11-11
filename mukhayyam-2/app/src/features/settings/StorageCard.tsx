import { useEffect, useState } from 'react'
import { getSupabase } from '../../data/supabase'
import { isDemo } from '../../config'
import { saveFile } from '../../lib/saveFile'
import { useConfirm } from '../../ui/Confirm'
import { Button } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
interface ColdBatch {
  id: string
  title: string
  date: string
  archived: boolean
  files: number
  bytes: number
}
interface Overview {
  audit_count: number
  old_audit_count: number
  audit_bytes: number
  reading_bytes: number
  batches: ColdBatch[]
}
interface Archive {
  app: string
  kind: string
  receipt: string
  data: unknown
}
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`
export function StorageCard() {
  const [data, setData] = useState<Overview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false)
  const [pending, setPending] = useState<Archive | null>(null),
    [checked, setChecked] = useState(false)
  const confirm = useConfirm(),
    toast = useToast()
  async function load() {
    if (isDemo) return
    const res = await getSupabase()!.rpc('storage_overview')
    setError(!!res.error)
    if (!res.error) setData(res.data as Overview)
  }
  useEffect(() => {
    void load()
  }, [])
  async function prepare(kind: 'audit' | 'reading', batch?: string) {
    setBusy(true)
    try {
      const res = await getSupabase()!.rpc('prepare_cold_archive', { p_kind: kind, p_batch: batch ?? null })
      if (res.error) throw res.error
      const archive = res.data as Archive
      await saveFile(
        JSON.stringify(archive),
        `mukhayyam2-archive-${kind}-${new Date().toISOString().slice(0, 10)}-${archive.receipt}.json`,
        'application/json',
      )
      setPending(archive)
      setChecked(false)
      toast('طلبنا تنزيل الأرشيف. تأكد إنه محفوظ عندك قبل التنظيف.')
    } catch {
      toast('تعذّر تجهيز الأرشيف. حاول مرة ثانية.', 'danger')
    } finally {
      setBusy(false)
    }
  }
  async function finish() {
    if (
      !pending ||
      !checked ||
      !(await confirm({
        title: 'تنظيف البيانات المؤرشفة؟',
        message:
          pending.kind === 'reading'
            ? 'القراءات وأسماء الملفات بتضل محفوظة. تنزيل Excel لهذا الأسبوع يحتاج استرجاع النسخ من الأرشيف الذي نزّلته.'
            : 'ستنحذف الحركات القديمة الموجودة في الأرشيف فقط. احتفظ بالملف بمكان آمن.',
        confirmLabel: 'تنظيف بعد الأرشفة',
        danger: true,
      }))
    )
      return
    setBusy(true)
    try {
      const res = await getSupabase()!.rpc('finish_cold_archive', { p_receipt: pending.receipt })
      if (res.error) throw res.error
      setPending(null)
      setChecked(false)
      await load()
      toast('تم تنظيف النسخ المؤرشفة')
    } catch {
      toast('ما تم التنظيف. ممكن البيانات تغيّرت؛ نزّل أرشيف جديد وحاول.', 'danger')
    } finally {
      setBusy(false)
    }
  }
  async function restore(file?: File) {
    if (!file || file.size > 100 * 1024 * 1024) {
      if (file) toast('الملف كبير كثير.', 'danger')
      return
    }
    setBusy(true)
    try {
      const archive: unknown = JSON.parse(await file.text())
      const res = await getSupabase()!.rpc('restore_reading_archive', { p_archive: archive })
      if (res.error) throw res.error
      await load()
      toast('رجعت ملفات الأسبوع. بتقدر تنزّل Excel من القراءات.')
    } catch {
      toast('الملف مش أرشيف صالح لهذا الأسبوع. ما تغيّر شيء.', 'danger')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="card storage-card">
      <header className="card-h">
        <h2>الأرشيف والمساحة</h2>
      </header>
      <div className="backup-body">
        <p>التنظيف اختياري للسجلات والأسابيع المعتمدة الأقدم من سنة. نزّل الأرشيف واحفظه أولًا؛ ما بنحذف شيء لحاله.</p>
        {error && (
          <p role="status">
            تعذّر قراءة المساحة.{' '}
            <button className="link-btn" onClick={() => void load()}>
              حاول مرة ثانية
            </button>
          </p>
        )}
        {data && (
          <>
            <p className="num">
              سجل الحركات: {data.audit_count} حركة · {mb(data.audit_bytes)} · ملفات القراءات: {mb(data.reading_bytes)}
            </p>
            <Button disabled={busy || !!pending || !data.old_audit_count} onClick={() => void prepare('audit')}>
              تنزيل أرشيف الحركات القديمة ({data.old_audit_count})
            </Button>
            <small className="muted">كل ملف حتى 5000 حركة. الحركات الأخيرة بتضل بالنظام.</small>
            <ul className="storage-list">
              {data.batches.map((b) => (
                <li key={b.id}>
                  <span>
                    <b>{b.title}</b>
                    <small>
                      {b.date} · {b.files} ملف · {b.archived ? 'ملفاته مؤرشفة' : mb(b.bytes)}
                    </small>
                  </span>
                  {!b.archived && (
                    <Button disabled={busy || !!pending} onClick={() => void prepare('reading', b.id)}>
                      تنزيل أرشيف الأسبوع
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {pending && (
          <div className="archive-confirm">
            <b>الملف المطلوب تنزيله جاهز</b>
            <label>
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> تأكدت إن
              الأرشيف نزل ومحفوظ عندي
            </label>
            <div className="task-actions">
              <Button variant="primary" disabled={!checked || busy} busy={busy} onClick={() => void finish()}>
                تنظيف النسخ المؤرشفة
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setPending(null)}>
                خلي البيانات مثل ما هي
              </Button>
            </div>
          </div>
        )}
        <label className="btn">
          استرجاع ملفات أسبوع من أرشيف
          <input
            type="file"
            accept=".json,application/json"
            hidden
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              void restore(f)
            }}
          />
        </label>
        <small className="muted">الاسترجاع يرجّع الملفات الأصلية فقط، وبيحافظ على القراءات الحالية.</small>
      </div>
    </section>
  )
}
