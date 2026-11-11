import { BellRing, CircleCheck, CircleAlert, Send } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { isValidPhone } from '../../lib/phone'
import { useOnline } from '../../lib/useOnline'
import { Segmented } from '../../ui/form'
import { Button, Pill } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { stamp } from '../sheets/ui'
import { alertsInfo, saveAlerts, smsError, testAlerts, type AlertsInfo } from './repo'

const KIND: Record<string, string> = {
  late_generation: 'تقرير التوليد',
  late_distribution: 'كشف التوزيع',
  late_task: 'مهام متأخرة',
  fuel_low: 'السولار',
  backup: 'النسخة الاحتياطية',
}
const JOB: Record<string, string> = { 'm2-daily-backup': 'النسخة الاحتياطية كل ليلة', 'm2-alerts': 'فحص التنبيهات كل نص ساعة' }

/**
 * The server texts the manager by itself (every 30 minutes), even when nobody has the site open:
 * a late report or sheet, a task past its time, diesel running out, the nightly backup missing.
 */
export function AlertsCard({ ready }: { ready: boolean }) {
  const toast = useToast()
  const online = useOnline()
  const [info, setInfo] = useState<AlertsInfo | null>(null)
  const [missing, setMissing] = useState(false)
  const [on, setOn] = useState<'on' | 'off'>('off')
  const [phones, setPhones] = useState(['', '', ''])
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)

  const load = useCallback(async () => {
    try {
      const i = await alertsInfo()
      setInfo(i)
      setOn(i.on ? 'on' : 'off')
      setPhones([0, 1, 2].map((k) => i.phones[k] ?? ''))
    } catch (e) {
      if (e instanceof Error && e.message === 'missing') setMissing(true)
    }
  }, [])
  useEffect(() => { if (online) void load() }, [online, load])

  const list = phones.map((p) => p.trim()).filter(Boolean)
  const bad = list.some((p) => !isValidPhone(p))

  async function save() {
    setBusy('save')
    try {
      await saveAlerts(on === 'on', list)
      toast(on === 'on' ? 'التنبيهات شغالة' : 'التنبيهات موقوفة')
      void load()
    } catch (e) {
      const m = e instanceof Error ? e.message : ''
      toast(m === 'no_phone' ? 'حط رقم جوال وحد على الأقل' : m === 'bad_phone' ? 'في رقم جوال غلط' : 'ما انحفظ. تأكد من الإنترنت.', 'danger')
    } finally {
      setBusy(null)
    }
  }

  async function test() {
    setBusy('test')
    try {
      const r = await testAlerts()
      if (r.sent) toast('انبعتت رسالة التجربة')
      else toast(`ما انبعتت: ${smsError(r.failed[0]?.code ?? '')}`, 'danger')
    } catch {
      toast('احفظ رقم جوال أول', 'danger')
    } finally {
      setBusy(null)
    }
  }

  if (missing) return null
  const lastBackupOld = info?.last_backup ? Date.now() - Date.parse(info.last_backup) > 36 * 3600_000 : false

  return (
    <section className="card sms-card alerts-card">
      <div className="card-h"><span className="ico-round brand"><BellRing size={16} /></span><h2>تنبيهات تلقائية بالرسائل</h2></div>
      <div className="sms-group">
        <p className="muted sms-small">
          الخادم بيفحص كل نص ساعة، حتى لو ما حدا فاتح الموقع، وبيبعت رسالة لما: يتأخر تقرير التوليد أو كشف التوزيع عن موعده، تتجاوز مهمة وقتها، يقرب السولار يخلص، أو ما تنعمل النسخة الاحتياطية. كل تنبيه بينبعت مرة وحدة بس.
        </p>
        <Segmented<'on' | 'off'> label="التنبيهات" value={on} options={[{ value: 'on', label: 'شغّالة' }, { value: 'off', label: 'موقوفة' }]} onChange={setOn} />
        <div className="alerts-phones">
          {phones.map((p, i) => (
            <label key={i} className="field">
              <span className="label">{i === 0 ? 'جوال المدير' : `جوال ${i + 1} (اختياري)`}</span>
              <input className="input num ltr" inputMode="tel" maxLength={10} value={p} placeholder="05xxxxxxxx" aria-invalid={(!!p.trim() && !isValidPhone(p.trim())) || undefined} onChange={(e) => setPhones((x) => x.map((v, k) => (k === i ? e.target.value.replace(/\D/g, '') : v)))} />
            </label>
          ))}
        </div>
        <div className="alerts-actions">
          <Button variant="primary" busy={busy === 'save'} disabled={!online || bad || (on === 'on' && !list.length)} onClick={() => void save()}>حفظ</Button>
          <Button variant="ghost" icon={<Send size={16} />} busy={busy === 'test'} disabled={!online || !ready || !info?.phones.length} onClick={() => void test()}>رسالة تجربة</Button>
        </div>
        {!ready && <p className="muted sms-small">بتشتغل بعد ما تربط حساب الرسائل (فوق).</p>}

        {info && (
          <div className="alerts-state">
            <b>هلأ</b>
            {info.due.length === 0 ? (
              <p className="muted"><CircleCheck size={15} /> ولا إشي متأخر</p>
            ) : (
              <ul>{info.due.map((d, i) => <li key={i}><Pill tone="warn">{KIND[d.kind] ?? d.kind}</Pill> {d.body.replace(/^مخيم 2: /, '')}</li>)}</ul>
            )}
            <b>شغل الخادم التلقائي</b>
            {!info.cron ? (
              <p className="muted"><CircleAlert size={15} /> المجدول (pg_cron) مش مفعّل بقاعدة البيانات.</p>
            ) : (
              <ul>
                {info.jobs.map((j) => (
                  <li key={j.name}>
                    <Pill tone={!j.active || j.last_status === 'failed' ? 'danger' : j.last_status === 'succeeded' ? 'ok' : 'warn'}>
                      {!j.active ? 'موقوف' : j.last_status === 'succeeded' ? 'شغّال' : j.last_status === 'failed' ? 'فشل' : 'لسا ما اشتغل'}
                    </Pill>{' '}
                    {JOB[j.name] ?? j.name}
                    {j.last_at && <small className="muted"> · آخر مرة {stamp(j.last_at)}</small>}
                    {j.last_status === 'failed' && j.last_error && <small className="alerts-err">{j.last_error}</small>}
                  </li>
                ))}
              </ul>
            )}
            <p className={lastBackupOld ? 'alerts-err' : 'muted'}>
              آخر نسخة احتياطية تلقائية: {info.last_backup ? stamp(info.last_backup) : 'ولا وحدة'}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
