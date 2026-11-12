import { AlarmClock, Printer, Search, UserX, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { isDemo } from '../../config'
import { describeDay, todayISO } from '../../lib/dates'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { EmptyArt } from '../../ui/fx/EmptyArt'
import { Chip } from '../../ui/form'
import { Avatar, Button } from '../../ui/primitives'
import { SignFooter } from '../sheets/signers'
import { UseDialog } from './dialogs'
import { fold, latinDigits, ordinalWord, skippedInBatches, type Seal, type SealData } from './model'
import { dayLabel, SealPill, SealsLoading, SealsTabs } from './parts'
import { useSealData, useSealsLive, useSealsReady } from './repo'

// Seals handed out to a technician and not yet recorded as used (or damaged, or lost): who has them,
// since when, and the numbers. The oldest are the ones to ask about.

/** Whole days between two ISO dates. */
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)

/** 0 → «اليوم»، 1 → «يوم»، 2 → «يومين»، 3–10 → «أيام»، وبعدها «يوم». */
const ageText = (n: number) => (n === 0 ? 'اليوم' : n === 1 ? 'يوم' : n === 2 ? 'يومين' : n <= 10 ? `${n} أيام` : `${n} يوم`)

interface BatchLine {
  key: string
  batchNo: number | null
  label: string
  issuedOn: string
  days: number
  seals: Seal[]
}
interface Person {
  id: string | null
  name: string
  lines: BatchLine[]
  count: number
  oldest: number
}

const LATE = [
  { value: 0, label: 'الكل' },
  { value: 4, label: 'أكثر من 3 أيام' },
  { value: 8, label: 'أكثر من أسبوع' },
  { value: 15, label: 'أكثر من أسبوعين' },
] as const

/** Page 4: the seals that are out and not recorded, per technician. */
export function SealUnrecordedPage() {
  useDocumentTitle('الأختام غير المسجّلة')
  useSealsLive()
  const ready = useSealsReady()
  const data = useSealData()
  const [minDays, setMinDays] = useState<number>(0)
  const [query, setQuery] = useState('')
  const [tech, setTech] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Seal | null>(null)
  const [printing, setPrinting] = useState<Person[] | null>(null)
  const today = todayISO()
  const skipped = useMemo(() => (data ? skippedInBatches(data.seals) : new Set<number>()), [data])

  // Each word typed must match: part of the seal number, the technician's name or the batch («الرابعة»).
  const words = useMemo(() => fold(latinDigits(query)).split(' ').filter(Boolean), [query])
  const people = useMemo<Person[]>(() => {
    if (!data) return []
    const batchById = new Map(data.batches.map((b) => [b.id, b]))
    const by = new Map<string, Person>()
    for (const s of data.seals) {
      if (s.status !== 'issued') continue
      const batch = s.batchId ? batchById.get(s.batchId) : undefined
      const techId = s.technicianId ?? batch?.technicianId ?? null
      const issuedOn = s.issuedOn ?? batch?.issuedOn ?? today
      const days = Math.max(0, daysBetween(issuedOn, today))
      if (days < minDays) continue
      const personKey = techId ?? '—'
      const name = techId ? data.names.get(techId) ?? '—' : 'بدون اسم'
      const label = batch ? `الدفعة ${batch.label?.trim() || ordinalWord(batch.batchNo)}` : 'أختام مصروفة'
      if (words.length) {
        const text = fold(`${name} ${label}`)
        if (!words.every((w) => String(s.sealNo).includes(w) || text.includes(w))) continue
      }
      const p = by.get(personKey) ?? by.set(personKey, { id: techId, name, lines: [], count: 0, oldest: 0 }).get(personKey)!
      const lineKey = batch?.id ?? `solo-${issuedOn}`
      let line = p.lines.find((l) => l.key === lineKey)
      if (!line) {
        line = { key: lineKey, batchNo: batch?.batchNo ?? null, label, issuedOn, days, seals: [] }
        p.lines.push(line)
      }
      line.seals.push(s)
      p.count++
      p.oldest = Math.max(p.oldest, days)
    }
    for (const p of by.values()) {
      p.lines.sort((a, b) => b.days - a.days || (a.batchNo ?? 0) - (b.batchNo ?? 0))
      for (const l of p.lines) l.seals.sort((a, b) => a.sealNo - b.sealNo)
    }
    // Names in alphabetical order (nobody is ranked); «بدون اسم» first, since it needs a name.
    return [...by.values()].sort((a, b) => Number(a.id !== null) - Number(b.id !== null) || a.name.localeCompare(b.name, 'ar'))
  }, [data, minDays, today, words])

  if (isDemo) return <div className="empty card"><h3>الأختام تعمل على قاعدة البيانات الحقيقية</h3><p>هذه الصفحة غير متاحة في وضع التجربة.</p></div>
  if (!ready || !data) return <SealsLoading />

  const shown = people.filter((p) => !tech || p.id === tech)
  const total = shown.reduce((n, p) => n + p.count, 0)
  const named = shown.filter((p) => p.id !== null)
  const oldest = shown.reduce((m, p) => Math.max(m, p.oldest), 0)
  const unnamed = people.find((p) => p.id === null)

  function print(list: Person[]) {
    setPrinting(list)
    window.setTimeout(() => window.print(), 150)
  }

  return (
    <div className="seals unrecorded">
      <header className="ph">
        <div>
          <h1>الأختام غير المسجّلة</h1>
          <p className="muted">أختام انصرفت لفنيين وما انسجّل استخدامها (ولا تالف ولا ضائع). اضغط على أي رقم وسجّل اللي صار فيه.</p>
        </div>
        <div className="ph-actions">
          {shown.length > 0 && <Button variant="secondary" icon={<Printer size={16} />} onClick={() => print(shown)}>{tech ? 'طباعة قائمة الفني' : 'طباعة القائمة كلها'}</Button>}
        </div>
      </header>

      <SealsTabs />

      <div className="uq-stats">
        <div className="card uq-stat"><b className="num">{total}</b><span>ختم لم يُسجَّل</span></div>
        <div className="card uq-stat"><b className="num">{named.length}</b><span>{named.length === 1 ? 'فني عنده' : 'فنيين عندهم'}</span></div>
        <div className="card uq-stat" data-tone={oldest >= 15 ? 'danger' : oldest >= 8 ? 'warn' : undefined}><b className="num">{oldest}</b><span>يوم أقدم صرف</span></div>
      </div>

      {unnamed && (
        <div className="banner info" role="status">
          <UserX size={18} />
          <p><b className="num">{unnamed.count}</b> ختم من دفعات <b>بدون اسم فني</b><span>سمّي الدفعة من «آخر ما صُرف» بزر «تعبئة الاسم» عشان يظهروا باسم الفني.</span></p>
        </div>
      )}

      <div className="uq-search" role="search">
        <Search size={20} aria-hidden="true" />
        <input
          type="search"
          inputMode="search"
          value={query}
          placeholder="ابحث: رقم الختم أو جزء منه · اسم الفني · الدفعة"
          aria-label="بحث في الأختام غير المسجّلة"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
        />
        {query && <button type="button" className="icon-btn" aria-label="مسح البحث" onClick={() => setQuery('')}><X size={18} /></button>}
      </div>

      <div className="uq-filters">
        <div className="chips" role="group" aria-label="كم صار من الصرف">
          {LATE.map((l) => <Chip key={l.value} pressed={minDays === l.value} onClick={() => setMinDays(l.value)}>{l.label}</Chip>)}
        </div>
        <select className="select tech-select" aria-label="الفني" value={tech ?? ''} onChange={(e) => setTech(e.target.value || null)}>
          <option value="">كل الفنيين</option>
          {people.filter((p) => p.id).map((p) => <option key={p.id} value={p.id!}>{p.name} ({p.count})</option>)}
        </select>
      </div>

      {shown.length === 0 ? (
        <section className="empty card">
          <EmptyArt kind="clipboard" />
          <h3>{query ? 'ما في نتائج للبحث' : minDays ? 'ولا ختم بهالمدة' : 'كل الأختام المصروفة مسجّلة'}</h3>
          <p>{query ? 'جرّب رقم أقصر أو اسم الفني. وإذا اخترت مدة أو فني، جرّب «الكل».' : minDays ? 'جرّب «الكل» لتشوف كل اللي عند الفنيين.' : 'ما في ختم عند فني بدون تسجيل.'}</p>
        </section>
      ) : (
        <div className="uq-list">
          {shown.map((p) => (
            <article key={p.id ?? 'none'} className="card uq-card">
              <header className="uq-head">
                {p.id ? <Avatar name={p.name} size={42} /> : <span className="uq-none"><UserX size={20} /></span>}
                <div className="uq-who">
                  <b>{p.name}</b>
                  <small className="num">{p.count} ختم · أقدمها من {p.oldest === 0 ? 'اليوم' : ageText(p.oldest)}</small>
                </div>
                <span className="grow" />
                <Button variant="ghost" icon={<Printer size={15} />} onClick={() => print([p])}>طباعة</Button>
              </header>
              {p.lines.map((l) => (
                <section key={l.key} className="uq-line" data-age={l.days >= 15 ? 'danger' : l.days >= 8 ? 'warn' : undefined}>
                  <div className="uq-line-h">
                    <b>{l.label}</b>
                    <span className="muted">صُرفت {l.issuedOn === today ? 'اليوم' : dayLabel(l.issuedOn)}</span>
                    <span className="uq-age num" title="من يوم الصرف"><AlarmClock size={13} /> {ageText(l.days)}</span>
                    <span className="grow" />
                    {l.seals.some((s) => skipped.has(s.sealNo)) && <span className="uq-skip-note">قفز عن {l.seals.filter((s) => skipped.has(s.sealNo)).length}</span>}
                    <small className="muted num">{l.seals.length} ختم</small>
                  </div>
                  <div className="uq-seals">
                    {l.seals.map((s) => <SealPill key={s.sealNo} seal={s} skipped={skipped.has(s.sealNo)} hit={words.some((w) => /^\d+$/.test(w) && String(s.sealNo).includes(w)) || undefined} onClick={() => setDialog(s)} />)}
                  </div>
                </section>
              ))}
            </article>
          ))}
        </div>
      )}

      {dialog && <UseDialog key={dialog.sealNo} data={data as SealData} seal={dialog} onClose={() => setDialog(null)} />}
      {printing && <UnrecordedPrint people={printing} today={today} />}
    </div>
  )
}

/** The list on paper, one block per technician, to chase them with: drawn only when printing. */
function UnrecordedPrint({ people, today }: { people: Person[]; today: string }) {
  const { weekday, date } = describeDay(today)
  return (
    <div className="print-sheet unrecorded-print" aria-hidden="true">
      <header className="ps-head">
        <img src="/logo.webp" alt="" className="ps-logo" />
        <div className="ps-title"><b>أختام لم يُسجَّل استخدامها</b><span>مخيم 2 · أبناء فارس أبو زايد</span></div>
        <div className="ps-date"><div>اليوم / {weekday}</div><div>التاريخ / <span className="num">{date}</span></div></div>
      </header>
      <table>
        <thead>
          <tr><th className="narrow">الفني</th><th className="narrow">الدفعة</th><th className="narrow">تاريخ الصرف</th><th className="narrow">منذ</th><th>أرقام الأختام</th><th className="narrow">ملاحظة</th></tr>
        </thead>
        <tbody>
          {people.flatMap((p) =>
            p.lines.map((l, i) => (
              <tr key={`${p.id}-${l.key}`}>
                {i === 0 && <td rowSpan={p.lines.length}><b>{p.name}</b><br /><small className="num">{p.count} ختم</small></td>}
                <td>{l.label.replace('الدفعة ', '')}</td>
                <td className="num">{describeDay(l.issuedOn).date}</td>
                <td className="num">{ageText(l.days)}</td>
                <td className="num">{l.seals.map((s) => s.sealNo).join(' · ')}</td>
                <td />
              </tr>
            )),
          )}
        </tbody>
      </table>
      <SignFooter />
    </div>
  )
}
