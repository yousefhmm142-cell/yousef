import { useLiveQuery } from 'dexie-react-hooks'
import { DatabaseBackup, Download } from 'lucide-react'
import { useState } from 'react'
import { downloadBackup, lastBackupAt } from '../../data/admin'
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
        <p className="muted">ملف واحد فيه كل التقارير والكشوف والموظفين. نزّله مرة في الأسبوع واحفظه في مكان آمن.</p>
        {last ? (
          <Pill tone={due ? 'warn' : 'ok'}>آخر نسخة: {stamp(last)}</Pill>
        ) : (
          <Pill tone="warn">لم تُنزَّل أي نسخة بعد</Pill>
        )}
      </div>
    </section>
  )
}
