import { MapPin,Wifi,X,Printer,QrCode,RefreshCw,Smartphone } from 'lucide-react'
import qrcode from 'qrcode-generator'
import { useEffect,useMemo,useState } from 'react'
import type { Employee } from '../../types'
import { Chip } from '../../ui/form'
import { Avatar,Button,Logo } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { useConfirm } from '../../ui/Confirm'
import { stamp } from '../sheets/ui'
import { SheetStateError } from '../sheets/workflow'
import {
renewPoint,
getPlace,
setPointPlace,
addOfficeNetwork,
setOfficeNetworks,
loadPunchAnywhere,
setPunchAnywhere,
revokeDevice,
useDevices,usePoints
} from './repo'
import { errText } from './attendanceData'

/** The printed sheet (its QR) and the phones allowed to record attendance. */
export function SheetAndPhones({ people }: { people: Employee[] }) {
  const toast = useToast()
  const points = usePoints()
  const devices = useDevices()
  const point = points?.find((p) => p.isActive)
  const url = point ? `${window.location.origin}/a/${point.code}` : ''
  const svg = useMemo(() => {
    if (!url) return ''
    const qr = qrcode(0, 'M')
    qr.addData(url)
    qr.make()
    return qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true })
  }, [url])
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [radius, setRadius] = useState(100)
  const [locating, setLocating] = useState(false)
  useEffect(() => {
    if (point?.radiusM) setRadius(point.radiusM)
  }, [point?.radiusM])
  const [networking, setNetworking] = useState(false)
  const [anywhere, setAnywhere] = useState<Set<string>>(new Set())
  useEffect(() => { void loadPunchAnywhere().then(setAnywhere) }, [])
  const ips = point?.allowedIps ?? []

  /** On the office internet: the address the server sees becomes the one scans must come from. */
  async function approveNetwork() {
    if (!point) return
    setNetworking(true)
    try {
      const r = await addOfficeNetwork(point)
      toast(`اعتُمدت شبكة المكتب (${r.ip})`)
    } catch (e) {
      toast(e instanceof SheetStateError && e.message === 'too_many' ? 'وصلت الحد (5 عناوين). احذف واحد قبل.' : errText(e) || 'تعذّر الاعتماد. تأكد من الإنترنت.', 'danger')
    } finally {
      setNetworking(false)
    }
  }
  async function toggleAnywhere(id: string, who: string) {
    const on = !anywhere.has(id)
    try {
      await setPunchAnywhere(id, on)
      setAnywhere((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n })
      toast(on ? `${who} بيسجّل من أي مكان` : `${who} رجع يسجّل من المكتب بس`)
    } catch (e) {
      toast(errText(e), 'danger')
    }
  }
  const name = (id: string) => people.find((e) => e.id === id)?.fullName ?? '—'
  const active = (devices ?? []).filter((d) => !d.revokedAt).sort((a, b) => name(a.employeeId).localeCompare(name(b.employeeId), 'ar'))

  /** Standing in the office: this phone's place becomes the place scans must come from. */
  async function setPlace() {
    if (!point) return
    setLocating(true)
    try {
      const here = await getPlace()
      await setPointPlace(point, { lat: here.lat, lng: here.lng }, radius)
      toast(`اعتُمد مكانك كموقع المكتب (دقة الجوال ${Math.round(here.acc)} متر)`)
    } catch (e) {
      toast(errText(e) || 'تعذّر معرفة مكانك. فعّل الموقع واسمح للمتصفح.', 'danger')
    } finally {
      setLocating(false)
    }
  }

  async function renew() {
    if (!point) return
    const yes = await confirm({
      title: 'ورقة حضور جديدة؟',
      message: 'الورقة القديمة المعلّقة تتوقف عن العمل فوراً، وعليك طباعة الجديدة وتعليقها بدلها.',
      confirmLabel: 'ورقة جديدة',
      danger: true,
    })
    if (!yes) return
    setBusy(true)
    try {
      await renewPoint(point)
      toast('صارت للورقة رمز جديد. اطبعها وعلّقها بدل القديمة.')
    } catch (e) {
      toast(errText(e), 'danger')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="att-sheet-grid">
        <section className="card att-qr">
          <div className="card-h"><span className="ico-round brand"><QrCode size={16} /></span><h2>ورقة الحضور</h2></div>
          {point ? (
            <>
              <div className="att-qr-img" dangerouslySetInnerHTML={{ __html: svg }} />
              <p className="muted">اطبعها وعلّقها عند باب المكتب. الموظف يصوّرها بكاميرا جواله: أول مرة يختار اسمه ويكتب رمزه، وبعدها كل تصويرة تسجّل لحالها.</p>
              <div className="task-actions">
                <Button variant="primary" icon={<Printer size={17} />} onClick={() => window.print()}>طباعة الورقة</Button>
                <Button variant="ghost" icon={<RefreshCw size={16} />} busy={busy} onClick={() => void renew()}>
                  ورقة جديدة بدل القديمة
                </Button>
              </div>
              <div className="att-place att-net">
                <b>شبكة المكتب (الإنترنت)</b>
                {ips.length > 0 ? (
                  <p className="muted">محدّد: التسجيل ما بينقبل إلا من إنترنت المكتب. لو حدا صوّر من بيانات الجوال أو من البيت بيطلعله «سجّل من واي فاي المكتب».</p>
                ) : (
                  <p className="muted">لسا ما حدّدتها: التسجيل بينقبل من أي إنترنت. وإنت جالس بالمكتب على واي فاي المكتب (مش بيانات الجوال) اضغط الزر.</p>
                )}
                {ips.length > 0 && (
                  <ul className="att-ips">
                    {ips.map((ip) => (
                      <li key={ip}><Wifi size={14} /><span className="num ltr">{ip}</span>
                        <button type="button" className="icon-btn sm" aria-label={`حذف ${ip}`} onClick={() => void setOfficeNetworks(point, ips.filter((x) => x !== ip)).then(() => toast('انحذف العنوان'), (e) => toast(errText(e), 'danger'))}><X size={14} /></button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="task-actions">
                  <Button variant="secondary" icon={<Wifi size={16} />} busy={networking} onClick={() => void approveNetwork()}>
                    {ips.length ? 'إضافة الشبكة اللي أنا عليها الآن' : 'اعتماد شبكة المكتب الحالية'}
                  </Button>
                </div>
                <p className="muted att-net-note">إذا عندكم خط إنترنت ثاني (احتياطي) اضغط الزر وإنت عليه كمان. لو غيّر المزوّد العنوان، اضغط الزر مرة ثانية.</p>
              </div>
              <div className="att-place">
                <b>موقع المكتب</b>
                {point.lat != null && point.lng != null ? (
                  <p className="muted">محدّد: التسجيل ما بينقبل إلا من مسافة <b className="num">{point.radiusM ?? 100}</b> متر من المكتب.</p>
                ) : (
                  <p className="muted">لسا ما حدّدته: التسجيل بينقبل من أي مكان. وإنت واقف في المكتب اضغط الزر.</p>
                )}
                <label className="field">
                  <span className="label">أبعد مسافة مسموحة (متر)</span>
                  <input className="input" type="number" inputMode="numeric" min={20} max={1000} value={radius} onChange={(e) => setRadius(Math.min(1000, Math.max(20, Number(e.target.value) || 100)))} />
                </label>
                <div className="task-actions">
                  <Button variant="secondary" icon={<MapPin size={16} />} busy={locating} onClick={() => void setPlace()}>
                    {point.lat != null ? 'تحديث موقع المكتب لمكاني الحالي' : 'اعتماد مكاني الحالي كموقع المكتب'}
                  </Button>
                  {point.lat != null && (
                    <Button variant="ghost" onClick={() => void setPointPlace(point, null, radius).then(() => toast('أُلغي تحديد الموقع'), (e) => toast(errText(e), 'danger'))}>إلغاء التحديد</Button>
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="card-empty">لا توجد نقطة حضور.</p>
          )}
        </section>
        <section className="card">
          <div className="card-h"><span className="ico-round brand"><Smartphone size={16} /></span><h2>الجوالات المسجّلة</h2></div>
          {active.length === 0 ? (
            <p className="card-empty">لم يسجّل أحد جواله بعد. يحصل هذا تلقائياً أول ما يصوّر الموظف الورقة.</p>
          ) : (
            <ul className="gen-list">
              {active.map((d) => (
                <li key={d.id}>
                  <Avatar name={name(d.employeeId)} size={34} />
                  <span className="gen-main">
                    <b>{name(d.employeeId)}</b>
                    <small>{d.label || 'جوال'} · آخر تسجيل: {d.lastUsedAt ? stamp(d.lastUsedAt) : 'لم يسجّل بعد'}</small>
                  </span>
                  <Chip pressed={anywhere.has(d.employeeId)} onClick={() => void toggleAnywhere(d.employeeId, name(d.employeeId))}>من أي مكان</Chip>
                  <Button variant="ghost" onClick={() => void revokeDevice(d.id).then(() => toast('أُوقف الجوال'), (e) => toast(errText(e), 'danger'))}>إيقاف</Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {point && (
        <div className="print-sheet qr-print" aria-hidden="true">
          <Logo height={70} />
          <h1>الحضور والانصراف</h1>
          <p className="qr-print-sub">مكتب مخيم 2 · أبناء فارس أبو زايد</p>
          <div className="qr-print-img" dangerouslySetInnerHTML={{ __html: svg }} />
          <ol>
            <li>افتح كاميرا الجوال ووجّهها على الكود، واضغط الرابط الذي يظهر.</li>
            <li>أول مرة فقط: اختر اسمك واكتب رمز الحضور من المدير.</li>
            <li>بعدها: صوّر عند الوصول وعند المغادرة. الوقت من الخادم.</li>
          </ol>
        </div>
      )}
    </>
  )
}
