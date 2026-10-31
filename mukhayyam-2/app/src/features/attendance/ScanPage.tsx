import { CheckCircle2, CircleAlert, LogIn, LogOut, UserRound, WifiOff } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { formatTime } from '../../lib/format'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { Button, Logo } from '../../ui/primitives'
import { PinInput } from '../../ui/PinInput'
import { SheetStateError } from '../sheets/workflow'
import { durationText } from '../tasks/model'
import { scanPeople, scanPunch, scanRegister, type ScanResult } from './repo'

// What a phone camera opens from the printed sheet in the office. No app, no sign-in.
// The first time on a phone: pick your name, type the 4-digit code from the admin. After that every
// scan records arrival or departure at once and shows it in big letters.

const KEY = 'm2-attendance-device'

function savedDevice(): { token: string; name: string } | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null')
  } catch {
    return null
  }
}
function saveDevice(v: { token: string; name: string } | null) {
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v))
    else localStorage.removeItem(KEY)
  } catch {
    // Private browsing: the code is asked again next time.
  }
}

type State =
  | { kind: 'working' }
  | { kind: 'done'; result: ScanResult }
  | { kind: 'choose'; people: Array<{ id: string; name: string }> }
  | { kind: 'code'; person: { id: string; name: string }; people: Array<{ id: string; name: string }> }
  | { kind: 'problem'; title: string; text: string; retry?: boolean }

const problems: Record<string, { title: string; text: string; retry?: boolean }> = {
  offline: { title: 'لا يوجد إنترنت', text: 'اتصل بالإنترنت وصوّر الورقة مرة ثانية.', retry: true },
  bad_point: { title: 'هذه الورقة لم تعد صالحة', text: 'صوّر ورقة الحضور الجديدة المعلّقة في المكتب.' },
  not_tracked: { title: 'حضورك لا يُسجَّل بهذه الورقة', text: 'تواصل مع المدير.' },
  no_code: { title: 'لم يُحدَّد لك رمز حضور بعد', text: 'اطلب رمز الحضور من المدير.' },
  locked: { title: 'محاولات خاطئة كثيرة', text: 'انتظر ربع ساعة ثم صوّر الورقة مرة ثانية.' },
}

export function AttendanceScanPage() {
  const { code: point = '' } = useParams()
  const [state, setState] = useState<State>({ kind: 'working' })
  const [pin, setPin] = useState('')
  const [wrong, setWrong] = useState(false)
  useDocumentTitle('الحضور والانصراف')

  const fail = (e: unknown) => {
    const code = e instanceof SheetStateError ? e.message : ''
    setState({ kind: 'problem', ...(problems[code] ?? { title: 'تعذّر التسجيل', text: 'صوّر الورقة مرة ثانية.', retry: true }) })
  }

  const chooseName = useCallback(async () => {
    setState({ kind: 'working' })
    try {
      setState({ kind: 'choose', people: await scanPeople(point) })
    } catch (e) {
      fail(e)
    }
  }, [point])

  const punch = useCallback(async () => {
    const device = savedDevice()
    if (!device) return chooseName()
    setState({ kind: 'working' })
    try {
      setState({ kind: 'done', result: await scanPunch(point, device.token) })
    } catch (e) {
      if (e instanceof SheetStateError && e.message === 'unknown_device') {
        // Switched off by the manager, or the key is from another sheet: register again.
        saveDevice(null)
        return chooseName()
      }
      fail(e)
    }
  }, [point, chooseName])

  useEffect(() => {
    void punch()
  }, [punch])

  async function register(person: { id: string; name: string }, code: string) {
    setWrong(false)
    try {
      const token = await scanRegister(point, person.id, code)
      if (!token) {
        setWrong(true)
        setPin('')
        return
      }
      saveDevice({ token, name: person.name })
      await punch()
    } catch (e) {
      fail(e)
    }
  }

  return (
    <div className="scan">
      <header className="tlink-head">
        <Logo height={34} />
        <span>مخيم 2 · الحضور</span>
      </header>

      {state.kind === 'working' && <div className="loading-block" aria-busy="true" />}

      {state.kind === 'done' && <Done result={state.result} onNotMe={() => { saveDevice(null); void chooseName() }} />}

      {state.kind === 'choose' && (
        <section className="card scan-step">
          <h1>مين إنت؟</h1>
          <p className="muted">أول مرة بس على هذا الجوال.</p>
          <div className="scan-people">
            {state.people.map((p) => (
              <button key={p.id} type="button" className="scan-person" onClick={() => { setPin(''); setWrong(false); setState({ kind: 'code', person: p, people: state.people }) }}>
                <UserRound size={18} />
                {p.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {state.kind === 'code' && (
        <section className="card scan-step">
          <h1>{state.person.name}</h1>
          <p className="muted">اكتب رمز الحضور (4 أرقام) اللي أعطاك إياه المدير.</p>
          <PinInput id="att-code" value={pin} length={4} invalid={wrong} onChange={(v) => { setPin(v); setWrong(false) }} onComplete={(v) => void register(state.person, v)} />
          {wrong && <p className="field-error" role="alert">الرمز غير صحيح. حاول مرة ثانية.</p>}
          <Button variant="ghost" onClick={() => setState({ kind: 'choose', people: state.people })}>لست {state.person.name}</Button>
        </section>
      )}

      {state.kind === 'problem' && (
        <div className="empty card">
          <span className="halo">{state.title.includes('إنترنت') ? <WifiOff size={28} /> : <CircleAlert size={28} />}</span>
          <h3>{state.title}</h3>
          <p>{state.text}</p>
          {state.retry && <Button variant="primary" onClick={() => void punch()}>حاول مرة ثانية</Button>}
        </div>
      )}
    </div>
  )
}

function Done({ result, onNotMe }: { result: ScanResult; onNotMe(): void }) {
  const last = result.punches[result.punches.length - 1]
  const first = result.punches.find((p) => p.kind === 'in')
  const out = last?.kind === 'out'
  const worked = out && first ? Math.round((Date.parse(last!.at) - Date.parse(first.at)) / 60_000) : null
  return (
    <section className={`scan-done card ${out ? 'out' : 'in'}`}>
      <span className="scan-ico">{out ? <LogOut size={34} /> : <LogIn size={34} />}</span>
      <p className="scan-hello">{out ? 'مع السلامة' : 'أهلاً'}، {result.name.split(' ')[0]}</p>
      <h1>{out ? 'سُجّل انصرافك' : 'سُجّل حضورك'}</h1>
      <p className="scan-time num">{last ? formatTime(new Date(last.at)) : ''}</p>
      {result.repeat && <p className="muted">مسجّل قبل لحظات، ما سجّلنا مرة ثانية.</p>}
      {worked !== null && <p className="muted num">مدة دوامك اليوم: {durationText(worked)}</p>}
      <ul className="scan-today">
        {result.punches.map((p, i) => (
          <li key={i}><CheckCircle2 size={15} />{p.kind === 'in' ? 'حضور' : 'انصراف'} <b className={`num ${p.kind === 'in' ? 't-in' : 't-out'}`}>{formatTime(new Date(p.at))}</b></li>
        ))}
      </ul>
      <button type="button" className="scan-notme" onClick={onNotMe}>لست {result.name}؟</button>
    </section>
  )
}
