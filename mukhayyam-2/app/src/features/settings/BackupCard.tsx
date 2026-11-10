import { useLiveQuery } from 'dexie-react-hooks'
import { DatabaseBackup, Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import { downloadBackup, downloadServerBackup, lastBackupAt, listServerBackups, type ServerBackup } from '../../data/admin'
import { isDemo } from '../../config'
import { stamp } from '../sheets/ui'
import { SheetStateError } from '../sheets/workflow'
import { Button, Pill } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'

const WEEK_MS = 7 * 24 * 3600_000

/** One click: every record in one file on this computer. Weekly is enough. */
export function BackupCard() {
  const toast = useToast()
  const last = useLiveQuery(() => lastBackupAt(), [])
  const [busy, setBusy] = useState(false)
  const due = !last || Date.now() - Date.parse(last) > WEEK_MS
  const [auto, setAuto] = useState<ServerBackup[] | null>(null)
  const [showAll, setShowAll] = useState(false)
  useEffect(() => {
    void listServerBackups().then(setAuto)
  }, [])

  async function run() {
    setBusy(true)
    try {
      await downloadBackup()
      toast('نُزّلت النسخة على هذا الجهاز')
    } catch (e) {
      toast(e instanceof SheetStateError && e.message === 'offline' ? 'النسخة تحتاج إنترنت' : 'تعذّر تنزيل النسخة', 'danger')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="card-h">
        <span className="ico-round brand"><DatabaseBackup size={16} /></span>
        <h2>النسخة الاحتياطية</h2>
        <Button variant={due ? 'primary' : 'secondary'} icon={<Download size={17} />} busy={busy} onClick={() => void run()} className="card-h-action">
          تنزيل نسخة الآن
        </Button>
      </div>
      <div className="backup-body">
        <p className="muted">ملف واحد فيه كل التقارير والكشوف والموظفين. نزّله مرة في الأسبوع واحفظه في مكان آمن (خارج هذا الجهاز).</p>
        {last ? (
          <Pill tone={due ? 'warn' : 'ok'}>آخر نسخة: {stamp(last)}</Pill>
        ) : (
          <Pill tone="warn">لم تُنزَّل أي نسخة بعد</Pill>
        )}
      </div>
      {!isDemo && (
        <div className="backup-auto">
          <b>نسخ تلقائية كل ليلة</b>
          <p className="muted">يأخذ النظام نسخة كل ليلة ويحتفظ بآخر 30. تحمي من حذف أو تعديل خاطئ؛ ولضياع الحساب كله تبقى النسخة الأسبوعية فوق.</p>
          {auto === null ? null : auto.length === 0 ? (
            <p className="muted">لا نسخ بعد (أو لا يوجد اتصال).</p>
          ) : (
            <ul className="gen-list">
              {(showAll ? auto : auto.slice(0, 5)).map((b) => (
                <li key={b.id}>
                  <span className="gen-main"><b>{stamp(b.takenAt)}</b><small className="num">{Math.max(1, Math.round(b.sizeBytes / 1024))} KB</small></span>
                  <Button variant="ghost" icon={<Download size={15} />} onClick={() => void downloadServerBackup(b).catch(() => toast('تعذّر التنزيل', 'danger'))}>تنزيل</Button>
                </li>
              ))}
            </ul>
          )}
          {auto && auto.length > 5 && !showAll && <button type="button" className="link-btn" onClick={() => setShowAll(true)}>كل النسخ ({auto.length})</button>}
        </div>
      )}
    </section>
  )
}
