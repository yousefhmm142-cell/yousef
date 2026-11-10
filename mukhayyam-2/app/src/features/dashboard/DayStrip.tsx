import { useState } from 'react'
import { Link } from 'react-router'
import { useCachedFeed, type FeedEvent } from './activity'
import { gazaDate } from '../attendance/rules'
import { todayISO } from '../../lib/dates'
import { formatTime } from '../../lib/format'
import { useNow } from '../../lib/useNow'

const minute = (iso: string | Date) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Gaza', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso))
  return Number(parts.find(p => p.type === 'hour')?.value) * 60 + Number(parts.find(p => p.type === 'minute')?.value)
}
const position = (minutes: number) => Math.max(0, Math.min(100, (minutes - 420) / 1020 * 100))
export function DayStrip() {
  const feed = useCachedFeed()
  const now = useNow(60_000)
  const [chosen, setChosen] = useState<string | null>(null)
  const today = todayISO()
  const events = (feed ?? []).filter(e => gazaDate(e.at) === today).sort((a,b) => a.at.localeCompare(b.at))
  const groups: FeedEvent[][] = []
  for (const e of events) {
    const previous = groups[groups.length - 1]
    if (previous && new Date(e.at).getTime() - new Date(previous[previous.length - 1]!.at).getTime() < 600_000) previous.push(e)
    else groups.push([e])
  }
  const selected = groups.find(g => g[0]!.id === chosen)
  return <section className="card fx-day fx-decoration" aria-label="يومك">
    <header className="card-h"><h2>يومك</h2><span className="meta">آخر حركات اليوم المحفوظة</span></header>
    <div className="fx-day-scroll"><div className="fx-day-axis">
      <div className="fx-day-line" /><div className="fx-day-future" style={{ width: `${100 - position(minute(now))}%` }} />
      {[420,540,720,900,1080,1260,1440].map((m,i) => <small key={m} style={{ insetInlineStart: `${position(m)}%` }}>{['7 ص','9 ص','12 ظ','3 م','6 م','9 م','12 ل'][i]}</small>)}
      {groups.map(g => <button key={g[0]!.id} type="button" className="fx-day-dot" data-kind={g[0]!.kind} style={{ insetInlineStart: `${position(minute(g[0]!.at))}%` }} aria-label={`${formatTime(new Date(g[0]!.at))}، ${g.length} حركة`} aria-expanded={chosen === g[0]!.id} onClick={() => setChosen(chosen === g[0]!.id ? null : g[0]!.id)}>{g.length > 1 ? g.length : <span className="sr-only">{g[0]!.text}</span>}</button>)}
      <span className="fx-day-now" style={{ insetInlineStart: `${position(minute(now))}%` }}><b>هلأ</b></span>
    </div></div>
    {selected && <div className="fx-day-bubble" aria-live="polite"><button className="link-btn" type="button" onClick={() => setChosen(null)}>إغلاق</button>{selected.map(e => <p key={e.id}><time className="num">{formatTime(new Date(e.at))}</time> · <b>{e.who}</b> {e.text} {e.route && <Link to={e.route}>افتح</Link>}</p>)}</div>}
    {!feed ? <p className="card-empty">جاري قراءة حركات اليوم…</p> : !events.length && <p className="card-empty">لسّا ما في حركات مسجّلة اليوم.</p>}
  </section>
}
