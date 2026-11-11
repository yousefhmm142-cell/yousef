import { ClipboardList, Gauge, MapPin, Phone, Search, Stamp, UserRound, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { isDemo } from '../../config'
import { getSupabase } from '../../data/supabase'
import { describeDay } from '../../lib/dates'
import { formatAmount } from '../../lib/numbers'
import { formatPhone } from '../../lib/phone'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { useOnline } from '../../lib/useOnline'
import { EmptyArt } from '../../ui/fx/EmptyArt'
import { Pill } from '../../ui/primitives'
import { stamp } from '../sheets/ui'
import { taskStatusInfo, type TaskStatus } from './model'
import { searchSubscribers, useSubscribers, type Subscriber } from './subscribers'

// One subscriber in one place: his line in the office's list, the tasks done for him, the seals recorded
// on his name or board, and his meter readings week by week. Read from the server (needs internet).

interface Profile {
  directory: Array<{ name: string; area: string | null; board: string | null; phone: string | null }>
  tasks: Array<{ id: string; number: number; type: string | null; status: TaskStatus; details: string | null; created_at: string; completed_at: string | null; notes: string | null; who: string | null }>
  seals: Array<{ seal_no: number; status: string; used_on: string | null; details: string | null; board: string | null; who: string | null }>
  readings: Array<{ week: string; period_to: string | null; code: string; board: string; prev: number | null; reading: number | null; state: string | null; at: string | null }>
}

const SEAL: Record<string, string> = { used: 'مستخدم', damaged: 'تالف', lost: 'ضائع' }
const STATE: Record<string, string> = { disconnected: 'مفصول', no_meter: 'بدون ساعة', other: 'ملاحظة', unknown: 'مش معروف' }

export function SubscriberPage() {
  const [params, setParams] = useSearchParams()
  const name = params.get('name') ?? ''
  const board = params.get('board') ?? ''
  const phone = params.get('phone') ?? ''
  useDocumentTitle(name ? `المشترك ${name}` : 'ملف مشترك')
  const online = useOnline()
  const subscribers = useSubscribers()
  const [query, setQuery] = useState('')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'offline'>('idle')

  const matches = useMemo(() => searchSubscribers(subscribers, query, 8), [subscribers, query])

  useEffect(() => {
    if (!name) return
    let alive = true
    const sb = getSupabase()
    if (isDemo || !sb || !online) {
      setState('offline')
      return
    }
    setState('loading')
    void sb.rpc('subscriber_profile', { p_name: name, p_board: board || null, p_phone: phone || null }).then(({ data, error }) => {
      if (!alive) return
      if (error) setState('error')
      else { setProfile(data as Profile); setState('idle') }
    })
    return () => { alive = false }
  }, [name, board, phone, online])

  const open = (s: { n: string; b?: string; p?: string }) => {
    setQuery('')
    setProfile(null)
    setParams({ name: s.n, ...(s.b ? { board: s.b } : {}), ...(s.p ? { phone: s.p } : {}) })
  }

  const line = profile?.directory[0]
  const done = profile?.tasks.filter((t) => t.status === 'done').length ?? 0

  return (
    <div className="subscriber-page">
      <header className="ph">
        <div>
          <h1>ملف مشترك</h1>
          <p className="muted">كل إشي صار لمشترك واحد: المهام، الأختام، والقراءات.</p>
        </div>
      </header>

      <div className="uq-search" role="search">
        <Search size={20} aria-hidden="true" />
        <input type="search" value={query} placeholder="اكتب اسم المشترك (جزأين من الاسم بيكفوا)" aria-label="بحث عن مشترك" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && query.trim().length >= 2 && open(matches[0] ? matches[0] : { n: query.trim() })} />
        {query && <button type="button" className="icon-btn" aria-label="مسح البحث" onClick={() => setQuery('')}><X size={18} /></button>}
      </div>
      {query.trim().length >= 2 && (
        <ul className="sp-matches card">
          {matches.map((s: Subscriber, i) => (
            <li key={i}><button type="button" onClick={() => open(s)}><b>{s.n}</b><small className="muted">{[s.a, s.b && `طبلون ${s.b}`].filter(Boolean).join(' · ')}</small></button></li>
          ))}
          <li><button type="button" onClick={() => open({ n: query.trim() })}><b>«{query.trim()}»</b><small className="muted">ابحث بهالاسم زي ما هو</small></button></li>
        </ul>
      )}

      {!name ? (
        <section className="empty card"><EmptyArt kind="clipboard" /><h3>اختار مشترك</h3><p>اكتب اسمه فوق. أو اضغط على اسم المشترك من أي مهمة.</p></section>
      ) : state === 'offline' ? (
        <section className="empty card"><h3>ملف المشترك بدو إنترنت</h3></section>
      ) : state === 'error' ? (
        <section className="empty card"><h3>ما قدرنا نجيب الملف</h3><p>حاول كمان مرة بعد شوي.</p></section>
      ) : !profile ? (
        <section className="card sp-loading" aria-busy="true">جاري التحميل…</section>
      ) : (
        <>
          <section className="card sp-head">
            <span className="ico-round brand"><UserRound size={20} /></span>
            <div className="sp-who">
              <h2>{line?.name ?? name}</h2>
              <p className="muted">
                {line?.area && <span><MapPin size={14} /> {line.area}</span>}
                {(line?.board || board) && <span>طبلون {line?.board || board}</span>}
                {(line?.phone || phone) && <span className="num ltr"><Phone size={14} /> {formatPhone(line?.phone || phone)}</span>}
              </p>
            </div>
            <div className="sp-stats">
              <div><b className="num">{profile.tasks.length}</b><small>مهمة ({done} منجزة)</small></div>
              <div><b className="num">{profile.seals.length}</b><small>ختم</small></div>
              <div><b className="num">{profile.readings.length}</b><small>قراءة</small></div>
            </div>
          </section>

          <section className="card">
            <div className="card-h"><span className="ico-round"><ClipboardList size={16} /></span><h2>المهام</h2></div>
            {profile.tasks.length === 0 ? <p className="card-empty">ما في مهام بهالاسم.</p> : (
              <ul className="sp-list">
                {profile.tasks.map((t) => (
                  <li key={t.id}>
                    <div className="sp-row"><b>#{t.number} · {t.type ?? 'مهمة'}</b><Pill tone={taskStatusInfo[t.status].tone}>{taskStatusInfo[t.status].label}</Pill></div>
                    <small className="muted">{stamp(t.created_at)}{t.who ? ` · ${t.who}` : ''}{t.completed_at ? ` · خلصت ${stamp(t.completed_at)}` : ''}</small>
                    {(t.details || t.notes) && <p>{[t.details, t.notes].filter(Boolean).join(' — ')}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="two">
            <section className="card">
              <div className="card-h"><span className="ico-round"><Stamp size={16} /></span><h2>الأختام</h2></div>
              {profile.seals.length === 0 ? <p className="card-empty">ما في أختام مسجّلة على اسمه أو طبلونه.</p> : (
                <ul className="sp-list">
                  {profile.seals.map((s) => (
                    <li key={s.seal_no}>
                      <div className="sp-row"><b className="num">ختم {s.seal_no}</b><Pill tone={s.status === 'used' ? 'ok' : 'warn'}>{SEAL[s.status] ?? s.status}</Pill></div>
                      <small className="muted">{s.used_on ? describeDay(s.used_on).date : '—'}{s.who ? ` · ${s.who}` : ''}</small>
                      {s.details && <p>{s.details}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="card">
              <div className="card-h"><span className="ico-round"><Gauge size={16} /></span><h2>القراءات</h2></div>
              {profile.readings.length === 0 ? <p className="card-empty">ما في قراءات بهالاسم.</p> : (
                <ul className="sp-list">
                  {profile.readings.map((r, i) => (
                    <li key={i}>
                      <div className="sp-row">
                        <b>{r.week}</b>
                        {r.reading !== null ? <span className="num">{formatAmount(r.prev ?? 0)} ← <b>{formatAmount(r.reading)}</b>{r.prev !== null && <small className="muted"> (+{formatAmount(Math.round((r.reading - r.prev) * 10) / 10)})</small>}</span> : <Pill tone="warn">{r.state ? STATE[r.state] ?? r.state : 'ما انقرت'}</Pill>}
                      </div>
                      <small className="muted">{[r.board && `طبلون ${r.board}`, r.code && `رمز ${r.code}`].filter(Boolean).join(' · ')}</small>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
