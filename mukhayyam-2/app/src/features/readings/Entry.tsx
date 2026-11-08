import { Check, ChevronDown, ChevronLeft, ChevronRight, Delete, FilePenLine, Info, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toLatinDigits } from '../../lib/phone'
import { fold } from '../tasks/subscribers'
import { BIG_USE, isDone, parseCode, sortRows, STATES, stateLabel, type ReadingRow, type ReadingState } from './model'

// Entering the readings, laid out like the field app of AF PowerCollect: the week at a glance, the boards of
// the area, then one board at a time with its own number pad (digits and the point only) and «التالي».

export type Saver = (row: ReadingRow, v: { reading: number | null; state: ReadingState | null; note: string | null }) => Promise<void>

const r1 = (v: number) => String(Math.round(v * 100) / 100)
const fmt = (v: number | null) => (v === null ? '—' : r1(v))
const parse = (s: string) => (s === '' || s === '.' ? null : Number(s.startsWith('.') ? `0${s}` : s))
const boardNo = (b: string) => toLatinDigits(b).match(/\d+/)?.[0] ?? b.slice(0, 2)

interface Board { key: string; area: string; rows: ReadingRow[]; done: number }

function boardsOf(rows: ReadingRow[]): Board[] {
  const map = new Map<string, Board>()
  for (const r of sortRows(rows)) {
    const k = `${r.area}|${r.board}`
    let b = map.get(k)
    if (!b) { b = { key: k, area: r.area, rows: [], done: 0 }; map.set(k, b) }
    b.rows.push(r)
    if (isDone(r)) b.done++
  }
  return [...map.values()]
}

function Ring({ pct }: { pct: number }) {
  const c = 2 * Math.PI * 30
  return (
    <span className="rf-ring" aria-hidden="true">
      <svg viewBox="0 0 70 70"><circle cx="35" cy="35" r="30" className="bg" /><circle cx="35" cy="35" r="30" className="fg" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} /></svg>
      <b className="num">{Math.round(pct * 100)}%</b>
    </span>
  )
}

export function ReadingsFlow({ rows, onSave, pending, title, showPhone = false, embedded = false }: { rows: ReadingRow[]; onSave: Saver; pending: Set<string>; title?: string; showPhone?: boolean; embedded?: boolean }) {
  const [box, setBox] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'left' | 'done'>('all')
  const [q, setQ] = useState('')
  const boards = useMemo(() => boardsOf(rows), [rows])
  const board = boards.find((b) => b.key === box)
  const topRef = useRef<HTMLDivElement>(null)
  const opened = useRef(false)
  useEffect(() => {
    // Moving between the list and a board starts at the top (not on the first look at the page).
    if (opened.current) window.scrollTo({ top: 0 })
    opened.current = true
  }, [box])

  if (board) return <div ref={topRef}><BoardView board={board} onSave={onSave} pending={pending} showPhone={showPhone} onBack={() => setBox(null)} /></div>

  const done = rows.filter(isDone).length
  const waiting = rows.filter((r) => pending.has(r.id)).length
  const words = fold(toLatinDigits(q)).split(' ').filter(Boolean)
  const match = (b: Board) => !words.length || words.every((w) => fold(`${b.rows[0]!.board} ${b.area} ${b.rows.map((r) => r.subscriber).join(' ')}`).includes(w))
  const count = (f: typeof filter) => boards.filter((b) => f === 'all' || (f === 'done' ? b.done === b.rows.length : b.done < b.rows.length)).length
  const shown = boards.filter((b) => match(b) && (q || filter === 'all' || (filter === 'done' ? b.done === b.rows.length : b.done < b.rows.length)))
  const resume = boards.find((b) => b.done > 0 && b.done < b.rows.length)
  const manyAreas = new Set(boards.map((b) => b.area)).size > 1
  let lastArea = ''

  return (
    <div className="rf" ref={topRef}>
      {!embedded && (
        <section className="rf-hero">
          <div>
            <small>قُرئت {title ? `· ${title}` : 'هذا الأسبوع'}</small>
            <b className="num">{done} من {rows.length}</b>
            {waiting > 0 ? <span className="rf-wait">{waiting === 1 ? 'قراءة وحدة' : waiting === 2 ? 'قراءتين' : `${waiting} قراءات`} بانتظار الإرسال</span>
              : done === rows.length && rows.length ? <span className="rf-ok">خلصت كل القراءات 👏</span> : null}
          </div>
          <Ring pct={rows.length ? done / rows.length : 0} />
        </section>
      )}
      {resume && !q && (
        <button type="button" className="rf-resume" onClick={() => setBox(resume.key)}>
          <FilePenLine size={24} />
          <span><b>كمّل من وين وقفت</b><small>طبلون {resume.rows[0]!.board} · باقي {resume.rows.length - resume.done}</small></span>
          <ChevronLeft size={20} />
        </button>
      )}
      <label className="rf-search"><Search size={19} /><input type="search" placeholder="رقم الطبلون أو اسم المشترك" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <div className="rf-sec">
        <h3>{embedded ? 'طبالين المنطقة' : 'طبالين منطقتك'}</h3>
        <div className="rf-chips" role="group" aria-label="العرض">
          {([['all', 'الكل'], ['left', 'الباقية'], ['done', 'المكتملة']] as const).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l} <span className="num">{count(k)}</span></button>
          ))}
        </div>
      </div>
      <div className="rf-list">
        {shown.length === 0 && <p className="rf-empty">{q ? 'ما في نتائج للبحث.' : filter === 'done' ? 'لسا ما خلص ولا طبلون.' : 'خلصت كل الطبالين.'}</p>}
        {shown.map((b) => {
          const full = b.done === b.rows.length
          const head = manyAreas && b.area !== lastArea ? b.area : null
          lastArea = b.area
          return (
            <div key={b.key} className="rf-group">
              {head && <h4 className="rf-area">{head}</h4>}
              <button type="button" className="rf-row" onClick={() => setBox(b.key)}>
                <span className={`rf-bb${full ? ' ok' : ''}`}>{full ? <Check size={20} strokeWidth={3} /> : <span className="num">{boardNo(b.rows[0]!.board)}</span>}</span>
                <span className="rf-tx"><b>طبلون {b.rows[0]!.board}</b><small>{b.area} · <span className="num">{b.rows.length}</span> مشترك</small></span>
                <span className="rf-pr">{full ? <span className="rf-tag ok">مكتمل</span> : <><b className="num">{b.done} من {b.rows.length}</b><span className="rf-mini"><i style={{ width: `${(b.done / b.rows.length) * 100}%` }} /></span></>}</span>
                <ChevronLeft size={18} className="rf-chev" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BoardView({ board, onSave, pending, showPhone, onBack }: { board: Board; onSave: Saver; pending: Set<string>; showPhone: boolean; onBack(): void }) {
  const rows = board.rows
  const firstOpen = rows.find((r) => !isDone(r)) ?? null
  const [sel, setSel] = useState<string | null>(firstOpen?.id ?? null)
  const [kp, setKp] = useState(!!firstOpen)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [states, setStates] = useState(false)
  const [note, setNote] = useState('')
  const sheetRef = useRef<HTMLDivElement>(null)
  const [pad, setPad] = useState(0)
  const cur = rows.find((r) => r.id === sel) ?? null
  const draftOf = (r: ReadingRow) => drafts[r.id] ?? (r.reading === null ? '' : r1(r.reading))
  const dv = cur ? draftOf(cur) : ''
  const v = parse(dv)
  const low = cur && v !== null && cur.prev !== null && v < cur.prev
  const use = cur && v !== null && cur.prev !== null && !low ? Math.round((v - cur.prev) * 100) / 100 : null

  // The rows scroll above the pad; the selected one is kept in sight.
  useEffect(() => {
    const el = sheetRef.current
    if (!el) { setPad(0); return }
    const ro = new ResizeObserver(() => setPad(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [kp, sel])
  useEffect(() => {
    if (!sel) return
    // Keep the chosen subscriber in the part of the screen the pad does not cover.
    const t = setTimeout(() => {
      const el = document.getElementById(`rf-r-${sel}`)
      if (!el) return
      const r = el.getBoundingClientRect()
      const cover = sheetRef.current?.offsetHeight ?? 0
      const free = window.innerHeight - cover
      const want = Math.max(90, free * 0.45 - r.height / 2)
      if (r.top < 90 || r.bottom > free - 8) window.scrollBy({ top: r.top - want, behavior: 'smooth' })
    }, 80)
    return () => clearTimeout(t)
  }, [sel, kp, pad])

  async function commit(r: ReadingRow): Promise<boolean> {
    const d = drafts[r.id]
    if (d === undefined) return true
    const n = parse(d)
    if (n === r.reading) { setDrafts(({ [r.id]: _, ...rest }) => rest); return true }
    if (n !== null && r.prev !== null && n < r.prev) return false
    await onSave(r, { reading: n, state: n === null ? r.state : null, note: r.note })
    setDrafts(({ [r.id]: _, ...rest }) => rest)
    return true
  }
  async function pick(r: ReadingRow) {
    if (cur && cur.id !== r.id) await commit(cur)
    setSel(r.id)
    setKp(true)
    setStates(false)
    setNote(r.note ?? '')
  }
  async function next() {
    if (!cur) return
    if (!(await commit(cur))) return
    const i = rows.indexOf(cur)
    const f = [...rows.slice(i + 1), ...rows.slice(0, i)].find((r) => r.id !== cur.id && !isDone(r) && drafts[r.id] === undefined)
    setStates(false)
    if (f) { setSel(f.id); setNote(f.note ?? '') } else setKp(false)
  }
  function key(k: string) {
    if (!cur) return
    const s = draftOf(cur)
    let n = s
    if (k === 'del') n = s.slice(0, -1)
    else if (k === '.') { if (!s.includes('.')) n = s ? `${s}.` : '0.' }
    else if (s.length < 9) n = s === '0' ? k : s + k
    setDrafts((d) => ({ ...d, [cur.id]: n }))
  }
  async function setState(st: ReadingState | null) {
    if (!cur) return
    setDrafts(({ [cur.id]: _, ...rest }) => rest)
    await onSave(cur, { reading: null, state: st, note: st === 'other' ? note : null })
    if (st && st !== 'other') { setStates(false); void next() }
  }

  // A computer keyboard works too.
  useEffect(() => {
    if (!kp) return
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select')) return
      const k = toLatinDigits(e.key)
      if (/^\d$/.test(k)) key(k)
      else if (k === '.' || k === '٫' || k === ',') key('.')
      else if (k === 'Backspace') key('del')
      else if (k === 'Enter') void next()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  })

  const done = rows.filter(isDone).length
  const verdict = !cur || v === null ? null
    : low ? { c: 'bad', t: `أقل من السابقة (${fmt(cur.prev)})` }
    : use !== null && use > BIG_USE ? { c: 'warn', t: 'استهلاك كبير · تأكد' }
    : { c: 'good', t: 'طبيعي' }
  const unsaved = Object.keys(drafts).length

  return (
    <div className="rf rf-board" style={{ paddingBottom: pad ? pad + 12 : undefined }}>
      <header className="rf-hdr">
        <button type="button" className="rf-back" aria-label="رجوع للطبالين" onClick={async () => { if (cur) await commit(cur); onBack() }}><ChevronRight size={22} /></button>
        <div><h2>طبلون {board.rows[0]!.board}</h2><small>{board.area} · {rows.length} مشترك</small></div>
      </header>
      <section className="rf-prog">
        <b>قُرئت <span className="num">{done} من {rows.length}</span></b>
        <span className="rf-mini big"><i style={{ width: `${(done / rows.length) * 100}%` }} /></span>
      </section>
      <div className="rf-subs">
        {rows.map((r, i) => {
          const isSel = kp && sel === r.id
          const d = drafts[r.id]
          const dn = d !== undefined ? parse(d) : null
          const dlow = dn !== null && r.prev !== null && dn < r.prev
          const seq = parseCode(r.code).seq
          let cell
          if (d !== undefined) {
            cell = <span className={`rf-cell${dlow ? ' low' : ''}`}><b className="num">{d || ' '}{isSel && <i className="rf-caret" />}</b><small className={dlow ? 'bad' : ''}>{dlow ? 'أقل من السابقة' : dn !== null && r.prev !== null ? `${r1(dn - r.prev)} ك.و.س` : ' '}</small></span>
          } else if (r.state) {
            cell = <span className="rf-cell st"><b>{stateLabel(r.state)}</b><small>{pending.has(r.id) ? 'على الجهاز' : 'وصلت'}</small></span>
          } else if (r.reading !== null) {
            cell = <span className="rf-cell done"><b className="num">{r1(r.reading)}</b><small>{pending.has(r.id) ? 'على الجهاز' : 'وصلت'}</small></span>
          } else {
            cell = <span className="rf-cell"><small className={isSel ? 'sel' : ''}>{isSel ? <>اكتب القراءة<i className="rf-caret" /></> : 'اضغط للإدخال'}</small></span>
          }
          const fin = isDone(r) && d === undefined
          return (
            <button key={r.id} id={`rf-r-${r.id}`} type="button" className={`rf-rr${isSel ? ' sel' : ''}`} onClick={() => void pick(r)}>
              <span className={`rf-n${fin && !isSel ? ' ok' : ''}${isSel ? ' on' : ''}`}>{fin && !isSel ? <Check size={16} strokeWidth={3} /> : <span className="num">{seq ?? i + 1}</span>}</span>
              <span className="rf-tx">
                <b>{r.subscriber || '—'}</b>
                <small>السابقة <span className="num">{fmt(r.prev)}</span>{r.fak && <> · <span className="num">({r.fak})</span></>}{showPhone && r.phone && <> · <span className="num ltr">{r.phone}</span></>}</small>
              </span>
              {cell}
            </button>
          )
        })}
      </div>
      {!kp && (
        <p className="rf-note"><Info size={18} />اضغط على أي مشترك عشان تكتب قراءته أو تعدّلها. كل قراءة بتنحفظ على جهازك فوراً وبتنرسل لحالها.</p>
      )}

      <div className="rf-sheet" ref={sheetRef}>
        {kp && cur && (
          <div className="rf-cmp">
            <div className="rf-cmp-top">
              <b>{cur.subscriber}</b>
              {verdict && <span className={`rf-verd ${verdict.c}`}>{verdict.t}</span>}
              <button type="button" className="rf-more" aria-expanded={states} onClick={() => setStates((x) => !x)}>{cur.state ? stateLabel(cur.state) : 'حالة ثانية'}<ChevronDown size={15} /></button>
            </div>
            {states && (
              <div className="rf-states">
                {STATES.map((s) => <button key={s.value} type="button" aria-pressed={cur.state === s.value} onClick={() => void setState(s.value)}>{s.label}</button>)}
                {cur.state && <button type="button" onClick={() => void setState(null)}>رجوع للقراءة</button>}
                {cur.state === 'other' && <input className="input" placeholder="شو المشكلة؟" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (cur.note ?? '') && void onSave(cur, { reading: null, state: 'other', note })} />}
              </div>
            )}
            <div className="rf-trio">
              <div><small>السابقة</small><b className="num">{fmt(cur.prev)}</b></div>
              <span className="op">←</span>
              <div className={`now${verdict ? ` ${verdict.c}` : ''}`}><small>الجديدة</small><b className="num">{dv || <span className="ph">اكتب</span>}</b></div>
              <span className="op">=</span>
              <div><small>الاستهلاك</small><b className="num">{use === null ? '—' : r1(use)}</b></div>
            </div>
          </div>
        )}
        {!kp && (
          <div className="rf-foot">
            <button type="button" className="rf-save" onClick={async () => { if (cur) await commit(cur); onBack() }}>
              <Check size={20} />{unsaved ? 'حفظ والرجوع للطبالين' : done === rows.length ? 'خلص الطبلون · رجوع للطبالين' : 'رجوع للطبالين'}
            </button>
          </div>
        )}
        {kp && cur && (
          <div className="rf-kp" dir="ltr">
            <button type="button" className="rf-hide" onClick={async () => { await commit(cur); setKp(false) }}><ChevronDown size={20} />إخفاء لوحة الأرقام</button>
            <div className="rf-keys">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'].map((k) => (
                <button key={k} type="button" className={`rf-k${k === '.' ? ' dot' : ''}`} aria-label={k === 'del' ? 'مسح' : k === '.' ? 'فاصلة عشرية' : k} onClick={() => key(k)}>
                  {k === 'del' ? <Delete size={24} /> : k}
                </button>
              ))}
              <button type="button" className="rf-k rf-next" disabled={!!low} onClick={() => void next()}>
                <ChevronLeft size={20} />{low ? 'القراءة أقل من السابقة' : rows.some((r) => r.id !== cur.id && !isDone(r)) ? 'التالي' : 'حفظ'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
