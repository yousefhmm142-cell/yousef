import { useLiveQuery } from 'dexie-react-hooks'
import { KeyRound, MessageSquareText, RefreshCw, Send, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { db } from '../../data/db'
import { formatPhone, isValidPhone } from '../../lib/phone'
import { useOnline } from '../../lib/useOnline'
import { useConfirm } from '../../ui/Confirm'
import { Segmented } from '../../ui/form'
import { Avatar, Button, Pill } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { titleOf } from '../../types'
import { AlertsCard } from './AlertsCard'
import { saveSmsLogin, sendCompanySms, smsError, smsInfo, smsParts, type SendResult, type SmsInfo } from './repo'

/** Settings › الرسائل: the subscription's balance, its login, and one message to many people. */
export function SmsPage() {
  const online = useOnline()
  const [info, setInfo] = useState<SmsInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const i = await smsInfo(true)
      setInfo(i)
      if (!i.ready) setEditing(true)
    } catch {
      setInfo((x) => x)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { if (online) void load() }, [online, load])

  const balance = info?.balance && /^-?\d+(\.\d+)?$/.test(info.balance) ? Number(info.balance) : null

  return (
    <div className="sms-page">
      <section className="card sms-head">
        <div className="sms-bal">
          <small>رصيد الرسائل</small>
          <b className="num">{balance !== null && balance >= 0 ? balance : '—'}</b>
          <span className="muted">
            {!online ? 'بدها إنترنت' : !info ? '…' : !info.ready ? 'لسا ما انربط حساب الرسائل' : balance === null || balance < 0 ? smsError(info.balance ?? '') : `رسالة باقية · المرسل «${info.sender}»`}
          </span>
        </div>
        <div className="sms-head-actions">
          <Button icon={<RefreshCw size={17} />} busy={loading} disabled={!online} onClick={() => void load()}>تحديث الرصيد</Button>
          <Button variant="ghost" icon={<KeyRound size={17} />} onClick={() => setEditing((x) => !x)}>حساب الرسائل</Button>
        </div>
        <p className="sms-note">
          رسائل المهام من المدير بتطلع من هالاشتراك (رسالة وحدة قصيرة لكل مهمة). مكتب المهام (مهند) بيضل يبعت من جواله. ملفات PDF بتضل على واتساب.
        </p>
      </section>

      {editing && <LoginCard info={info} onSaved={() => { setEditing(false); void load() }} />}
      <GroupCard ready={!!info?.ready} onSent={() => void load()} />
      <AlertsCard ready={!!info?.ready} />
    </div>
  )
}

function LoginCard({ info, onSaved }: { info: SmsInfo | null; onSaved(): void }) {
  const toast = useToast()
  const [user, setUser] = useState(info?.user ?? '')
  const [pass, setPass] = useState('')
  const [sender, setSender] = useState(info?.sender ?? 'AF Camp2')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (info) { setUser(info.user ?? ''); setSender(info.sender) } }, [info])
  async function save() {
    setBusy(true)
    try {
      await saveSmsLogin(user, pass, sender)
      toast('انحفظ حساب الرسائل')
      setPass('')
      onSaved()
    } catch {
      toast('ما انحفظ. تأكد من الإنترنت.', 'danger')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="card sms-card">
      <div className="card-h"><span className="ico-round brand"><KeyRound size={16} /></span><h2>حساب الرسائل (هوت SMS)</h2></div>
      <div className="sms-form">
        <label className="field"><span className="label">اسم المستخدم</span><input className="input" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" /></label>
        <label className="field"><span className="label">كلمة السر</span><input className="input" type="password" value={pass} placeholder={info?.ready ? 'محفوظة · اكتب جديدة بس إذا تغيّرت' : ''} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" /></label>
        <label className="field"><span className="label">اسم المرسل</span><input className="input" value={sender} onChange={(e) => setSender(e.target.value)} dir="ltr" /></label>
        <p className="muted sms-small">كلمة السر بتنحفظ على الخادم بس، وما حدا بيقدر يقرأها بعدين (حتى من هون).</p>
        <Button variant="primary" busy={busy} disabled={!user.trim() || (!info?.ready && !pass)} onClick={() => void save()}>حفظ</Button>
      </div>
    </section>
  )
}

function GroupCard({ ready, onSent }: { ready: boolean; onSent(): void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const online = useOnline()
  const people = useLiveQuery(async () => (await db.employees.toArray()).filter((e) => e.isActive && !e.deletedAt).sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar')), []) ?? []
  const reachable = people.filter((p) => p.phone && isValidPhone(p.phone))
  const [mode, setMode] = useState<'all' | 'pick'>('all')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  const [result, setResult] = useState<SendResult | null>(null)
  const to = useMemo(() => (mode === 'all' ? reachable : reachable.filter((p) => picked.has(p.id))), [mode, reachable, picked])
  const parts = smsParts(text.trim())
  const cost = to.length * parts

  async function send() {
    const yes = await confirm({ title: `إرسال الرسالة لـ ${to.length} ${to.length === 1 ? 'شخص' : 'أشخاص'}؟`, message: `بتنحسب ${cost} ${cost === 1 ? 'رسالة' : 'رسائل'} من الرصيد.`, confirmLabel: 'إرسال' })
    if (!yes) return
    setBusy(0)
    setResult(null)
    try {
      const r = await sendCompanySms(to.map((p) => p.phone!), text.trim(), null, setBusy)
      setResult(r)
      if (r.sent) toast(`انبعتت لـ ${r.sent} ${r.sent === 1 ? 'شخص' : 'أشخاص'}`)
      if (r.failed.length) toast(`ما انبعتت لـ ${r.failed.length}: ${smsError(r.failed[0]!.code)}`, 'danger')
      if (r.sent && !r.failed.length) setText('')
      onSent()
    } catch {
      toast('بدها إنترنت', 'danger')
    } finally {
      setBusy(null)
    }
  }

  const nameOf = (phone: string) => people.find((p) => p.phone === phone)?.fullName ?? formatPhone(phone)

  return (
    <section className="card sms-card">
      <div className="card-h"><span className="ico-round brand"><Users size={16} /></span><h2>رسالة جماعية</h2><span className="meta">{reachable.length} موظف برقم جوال</span></div>
      <div className="sms-group">
        <Segmented<'all' | 'pick'> label="لمين" value={mode} options={[{ value: 'all', label: `كل الموظفين (${reachable.length})` }, { value: 'pick', label: 'أختار أنا' }]} onChange={setMode} />
        {mode === 'pick' && (
          <div className="sms-people">
            <div className="sms-people-tools">
              <button type="button" className="link-btn" onClick={() => setPicked(new Set(reachable.map((p) => p.id)))}>الكل</button>
              <button type="button" className="link-btn" onClick={() => setPicked(new Set())}>ولا حدا</button>
              <span className="muted num">{picked.size} مختار</span>
            </div>
            <ul>
              {people.map((p) => {
                const ok = !!p.phone && isValidPhone(p.phone)
                return (
                  <li key={p.id}>
                    <label className={ok ? '' : 'off'}>
                      <input type="checkbox" disabled={!ok} checked={picked.has(p.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n })} />
                      <Avatar name={p.fullName} size={30} />
                      <span><b>{p.fullName}</b><small>{ok ? <span className="num ltr">{formatPhone(p.phone!)}</span> : 'بدون رقم جوال'} · {titleOf(p)}</small></span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        <label className="field">
          <span className="label">نص الرسالة</span>
          <textarea className="input sms-text" rows={3} maxLength={335} value={text} onChange={(e) => setText(e.target.value)} placeholder="مثلاً: اجتماع لكل الموظفين بكرة الساعة 9 بالمكتب" />
        </label>
        <div className="sms-count">
          <Pill tone={parts > 1 ? 'warn' : 'ok'}>{text.trim().length}/{parts > 1 ? 67 * parts : 70} · {parts === 1 ? 'رسالة وحدة' : `${parts} رسائل لكل شخص`}</Pill>
          <span className="muted">بتنحسب <b className="num">{cost}</b> من الرصيد</span>
        </div>
        <Button variant="primary" size="lg" icon={<Send size={18} />} busy={busy !== null} disabled={!ready || !online || !text.trim() || !to.length || busy !== null} onClick={() => void send()}>
          {busy !== null ? `جاري الإرسال… ${busy}/${to.length}` : `إرسال لـ ${to.length} ${to.length === 1 ? 'شخص' : 'أشخاص'}`}
        </Button>
        {!ready && <p className="muted sms-small">لازم تربط حساب الرسائل أول (فوق).</p>}
        {result && result.failed.length > 0 && (
          <ul className="sms-failed">
            {result.failed.map((f) => <li key={f.phone}><MessageSquareText size={14} />{nameOf(f.phone)}: {smsError(f.code)}</li>)}
          </ul>
        )}
      </div>
    </section>
  )
}
