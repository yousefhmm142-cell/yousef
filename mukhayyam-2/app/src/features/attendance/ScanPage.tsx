import { CheckCircle2, CircleAlert, LogIn, LogOut, MapPinOff, UserRound, WifiOff } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { formatTime } from '../../lib/format'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { Button, Logo } from '../../ui/primitives'
import { PinInput } from '../../ui/PinInput'
import { SheetStateError } from '../sheets/workflow'
import { durationText } from '../tasks/model'
import { useNow } from '../../lib/useNow'
import { getPlace, scanPeople, scanPunch, scanRegister, type PhonePlace, type ScanResult } from './repo'

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
  location_denied: { title: 'لازم تسمح بالموقع', text: 'الحضور بيتسجّل من المكتب بس. فعّل الموقع (GPS) في الجوال واسمح للمتصفح باستخدامه، وبعدين صوّر الورقة مرة ثانية.', retry: true },
  location_failed: { title: 'ما قدرنا نعرف مكانك', text: 'تأكد إن الموقع (GPS) شغّال وجرّب من جنب شباك أو من برّا، وبعدين حاول مرة ثانية.', retry: true },
}

export function AttendanceScanPage() {
  const { code: point = '' } = useParams()
  const [state, setState] = useState<State>({ kind: 'working' })
  const [pin, setPin] = useState('')
  const [wrong, setWrong] = useState(false)
  useDocumentTitle('الحضور والانصراف')

  // A refreshed page must never end the day by accident: it only looks, and offers the button.
  const [reloaded] = useState(() => {
    try {
      return (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'reload'
    } catch {
      return false
    }
  })

  const fail = (e: unknown) => {
    const [code = '', arg = ''] = e instanceof SheetStateError ? e.message.split(':') : []
    if (code === 'too_far') {
      const m = Number(arg)
      return setState({ kind: 'problem', title: 'أنت بعيد عن المكتب', text: `الحضور بيتسجّل من المكتب بس${m ? ` (إنت على بعد حوالي ${m >= 1000 ? `${(m / 1000).toFixed(1)} كم` : `${m} متر`})` : ''}. صوّر الورقة وإنت في المكتب.`, retry: true })
    }
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

  const punch = useCallback(async (peek = false) => {
    const device = savedDevice()
    if (!device) return chooseName()
    setState({ kind: 'working' })
    try {
      let place: PhonePlace | undefined
      let result: ScanResult
      try {
        result = await scanPunch(point, device.token, { peek })
      } catch (e) {
        // The office place is set: the phone says where it is, and asks its owner the first time.
        if (!(e instanceof SheetStateError && e.message === 'need_location')) throw e
        place = await getPlace()
        result = await scanPunch(point, device.token, { peek, place })
      }
      setState({ kind: 'done', result })
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
    void punch(reloaded)
  }, [punch, reloaded])

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

      {state.kind === 'done' && <Done result={state.result} onRecord={() => void punch(false)} onNotMe={() => { saveDevice(null); void chooseName() }} />}

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
          <span className="halo">{state.title.includes('إنترنت') ? <WifiOff size={28} /> : state.title.includes('المكتب') || state.title.includes('مكان') || state.title.includes('الموقع') ? <MapPinOff size={28} /> : <CircleAlert size={28} />}</span>
          <h3>{state.title}</h3>
          <p>{state.text}</p>
          {state.retry && <Button variant="primary" onClick={() => void punch(false)}>حاول مرة ثانية</Button>}
        </div>
      )}
    </div>
  )
}

function Done({ result, onRecord, onNotMe }: { result: ScanResult; onRecord(): void; onNotMe(): void }) {
  const now = useNow(15_000)
  const status = result.status
  // Not a fresh recording: the page only shows today's record (and what can be done next).
  if (status === 'wait' || status === 'ready' || status === 'full') {
    const until = result.wait_until ? Date.parse(result.wait_until) : 0
    const left = Math.max(0, Math.ceil((until - now.getTime()) / 60_000))
    const canNow = status === 'ready' || (status === 'wait' && left === 0)
    return (
      <section className="scan-done card in">
        <span className="scan-ico">{status === 'full' ? <CheckCircle2 size={34} /> : <LogIn size={34} />}</span>
        <p className="scan-hello">أهلاً، {result.name.split(' ')[0]}</p>
        <h1>{status === 'full' ? 'سجّلت حضورك وانصرافك اليوم' : result.next === 'out' ? 'حضورك مسجّل' : 'ما سجّلت حضورك بعد'}</h1>
        {status === 'wait' && left > 0 && (
          <p className="muted">تقدر تسجّل انصرافك بعد <b className="num">{durationText(left)}</b> (الساعة <b className="num">{formatTime(new Date(until))}</b>). الصفحة بتتحدّث لحالها.</p>
        )}
        {status === 'full' && <p className="muted">لكل موظف تسجيلتين باليوم: حضور وانصراف.</p>}
        {canNow && (
          <Button variant="primary" size="lg" icon={result.next === 'out' ? <LogOut size={18} /> : <LogIn size={18} />} onClick={onRecord}>
            {result.next === 'out' ? 'سجّل انصرافي الآن' : 'سجّل حضوري الآن'}
          </Button>
        )}
        <ul className="scan-today">
          {result.punches.map((p, i) => (
            <li key={i}><CheckCircle2 size={15} />{p.kind === 'in' ? 'حضور' : 'انصراف'} <b className={`num ${p.kind === 'in' ? 't-in' : 't-out'}`}>{formatTime(new Date(p.at))}</b></li>
          ))}
        </ul>
        <button type="button" className="scan-notme" onClick={onNotMe}>لست {result.name}؟</button>
      </section>
    )
  }
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
