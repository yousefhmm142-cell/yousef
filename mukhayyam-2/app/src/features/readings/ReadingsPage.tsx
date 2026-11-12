import { buzz } from '../../lib/appearance'
import { BoardMoveDialog } from './BoardMoveDialog'
import { EmptyArt } from '../../ui/fx/EmptyArt'
import { Skeleton } from '../../ui/fx/Skeleton'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, CheckCircle2, CloudOff, Download, FileSpreadsheet, FileText, FileUp, Gauge, Lock, Printer, RefreshCw, Trash2, Unlock, UserPlus, Users, X } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEmployee } from '../../auth/AuthProvider'
import { getActions, onActionsSent } from '../../data/actions'
import { db } from '../../data/db'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { saveFile } from '../../lib/saveFile'
import { useOnline } from '../../lib/useOnline'
import { useConfirm } from '../../ui/Confirm'
import { Dialog } from '../../ui/Dialog'
import { Avatar, Button, Pill } from '../../ui/primitives'
import { ReadingsFlow, type Saver } from './Entry'
import { exportWeek, readReadingsFile, type ReadFile } from './excel'
import { areaKey, isDone, parseCode, sortRows, stateLabel, summarizeAreas, type AreaSummary, type ReadingBatch, type ReadingRow } from './model'
import {
  addFiles, assignArea, batchSaved, createBatch, deleteBatch, deleteFile, flushReadings, listBatches, listFiles, loadBatchRows, moveBoard, myReadingsSaved, refreshMyReadings, saveReading, setBatchStatus, weekSources, type WeekFile,
} from './repo'

const say = (text: string, tone: 'ok' | 'danger' = 'ok') => window.dispatchEvent(new CustomEvent('m2-toast', { detail: { text, tone } }))
const fmt = (v: number | null) => (v === null ? '—' : String(Math.round(v * 10) / 10))

/** «القراءات»: the office runs the week; a reader (technician) types his readings, with or without internet. */
export function ReadingsPage() {
  useDocumentTitle('القراءات')
  const me = useEmployee()
  const admin = me.role === 'admin' || me.role === 'manager' || !!me.pages?.includes('readings-admin')
  return admin ? <AdminReadings /> : <ReaderReadings />
}

// ---------- «جاري المزامنة» ----------
function useWaitingReadings(): number {
  return useLiveQuery(async () => (await getActions()).filter((a) => a.table === 'reading_rows').length, []) ?? 0
}

function SyncBanner() {
  const online = useOnline()
  const waiting = useWaitingReadings()
  const [justSent, setJustSent] = useState(false)
  const before = useRef(waiting)
  useEffect(() => {
    if (before.current > 0 && waiting === 0 && online) {
      setJustSent(true)
      const t = window.setTimeout(() => setJustSent(false), 3500)
      before.current = waiting
      return () => window.clearTimeout(t)
    }
    before.current = waiting
  }, [waiting, online])
  useEffect(() => { if (online && waiting) void flushReadings() }, [online, waiting])

  if (waiting && online) return <p className="rd-sync busy" role="status"><RefreshCw size={16} className="spin" /> جاري المزامنة… <b className="num">{waiting}</b></p>
  if (waiting) return <p className="rd-sync off" role="status"><CloudOff size={16} /> بدون إنترنت · <b className="num">{waiting}</b> {waiting === 1 ? 'قراءة محفوظة' : 'قراءات محفوظة'} على جهازك، وبتنرسل لحالها لما يرجع النت</p>
  if (justSent) return <p className="rd-sync ok" role="status"><CheckCircle2 size={16} /> تمت المزامنة · كل القراءات وصلت</p>
  if (!online) return <p className="rd-sync off" role="status"><CloudOff size={16} /> بدون إنترنت · اشتغل عادي، كل قراءة بتنحفظ على جهازك</p>
  return null
}

/** Rows typed here and not on the server yet. */
function usePendingRows(): Set<string> {
  return useLiveQuery(async () => new Set((await getActions()).filter((a) => a.table === 'reading_rows' && a.rowId).map((a) => a.rowId!)), []) ?? new Set<string>()
}

// ---------- The reader ----------
function ReaderReadings() {
  const me = useEmployee()
  const pending = usePendingRows()
  const online = useOnline()
  const [data, setData] = useState<{ batches: ReadingBatch[]; rows: ReadingRow[] } | null>(null)
  const [batchId, setBatchId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const fresh = await refreshMyReadings(me.id)
    if (fresh) setData(fresh)
  }, [me.id])
  useEffect(() => {
    let live = true
    void myReadingsSaved(me.id).then((d) => live && setData((x) => x ?? d))
    void load()
    const off = onActionsSent(load)
    return () => { live = false; off() }
  }, [me.id, load])
  useEffect(() => { if (online) void load() }, [online, load])

  const batch = data?.batches.find((b) => b.id === batchId) ?? data?.batches[0]
  const rows = useMemo(() => (data && batch ? data.rows.filter((r) => r.batchId === batch.id) : []), [data, batch])

  const onSave: Saver = async (row, v) => {
    const patch = await saveReading(row, v, { me: me.id })
    buzz()
    setData((d) => d && { ...d, rows: d.rows.map((r) => (r.id === row.id ? { ...r, ...patch, enteredAt: new Date().toISOString() } : r)) })
  }

  return (
    <div className="report-page readings">
      <header className="ph">
        <div>
          <h1>القراءات</h1>
          <p className="muted">{batch ? batch.title : 'قراءات العدادات الأسبوعية'}</p>
        </div>
        {data && data.batches.length > 1 && (
          <select className="select" aria-label="الأسبوع" value={batch?.id} onChange={(e) => setBatchId(e.target.value)}>
            {data.batches.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
          </select>
        )}
      </header>
      <SyncBanner />
      {!data ? <Skeleton kind="list" />
        : !batch ? <p className="card card-empty"><EmptyArt kind="bulb" />ما في قراءات عليك هالأسبوع. لما يوزّع مسؤول القراءات المناطق بتظهر هون.</p>
        : <ReadingsFlow rows={rows} onSave={onSave} pending={pending} title={data && data.batches.length > 1 ? batch.title : undefined} />}
    </div>
  )
}

// ---------- The office ----------
type Person = { id: string; fullName: string; pages?: string[] }
type Picked = { name: string; read: ReadFile | null; error?: string; dup?: boolean }

function AdminReadings() {
  const me = useEmployee()
  const pending = usePendingRows()
  const online = useOnline()
  const confirm = useConfirm()
  const [batches, setBatches] = useState<ReadingBatch[] | null>(null)
  const [batchId, setBatchId] = useState<string | null>(null)
  const [rows, setRows] = useState<ReadingRow[] | null>(null)
  const [files, setFiles] = useState<WeekFile[]>([])
  const [showFiles, setShowFiles] = useState(false)
  const [picked, setPicked] = useState<Picked[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [openArea, setOpenArea] = useState<string | null>(null)
  const [assignFor, setAssignFor] = useState<AreaSummary | null>(null)
  const [printArea, setPrintArea] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const people: Person[] = useLiveQuery(async () => (await db.employees.toArray()).filter((e) => e.isActive && !e.deletedAt && (e.role === 'technician' || e.pages?.includes('readings'))).sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar')), []) ?? []

  const loadBatches = useCallback(async () => {
    try {
      const list = await listBatches()
      setBatches(list)
      setBatchId((id) => (id && list.some((b) => b.id === id) ? id : list[0]?.id ?? null))
    } catch {
      setBatches((b) => b ?? [])
    }
  }, [])
  const loadRows = useCallback(async (id: string) => {
    const saved = await batchSaved(id)
    if (saved) setRows(saved)
    try { setRows(await loadBatchRows(id)) } catch { if (!saved) setRows([]) }
    try { setFiles(await listFiles(id)) } catch { /* offline: the list comes back with the internet */ }
  }, [])
  useEffect(() => { void loadBatches() }, [loadBatches, online])
  useEffect(() => { setRows(null); setFiles([]); if (batchId) void loadRows(batchId) }, [batchId, loadRows])
  useEffect(() => onActionsSent(() => batchId && loadRows(batchId)), [batchId, loadRows])

  const [movingBoard, setMovingBoard] = useState<{ board: string; area: string } | null>(null)
  const batch = batches?.find((b) => b.id === batchId) ?? null
  const areas = useMemo(() => (rows ? summarizeAreas(rows) : []), [rows])
  const done = rows?.filter(isDone).length ?? 0
  const area = areas.find((a) => a.area === openArea) ?? null

  async function pickFiles(list: FileList | null) {
    if (!list?.length) return
    setBusy('read')
    const names = new Set(files.map((f) => f.name))
    const out: Picked[] = []
    for (const f of [...list]) {
      try { out.push({ name: f.name, read: await readReadingsFile(f), dup: names.has(f.name) }) }
      catch { out.push({ name: f.name, read: null, error: 'ما انقرأ: لازم يكون كشف Excel من الشركة (xlsx)' }) }
    }
    setPicked(out)
    setBusy(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function run(key: string, job: () => Promise<unknown>, ok?: string) {
    setBusy(key)
    try {
      await job()
      if (ok) say(ok)
    } catch (e) {
      say(e instanceof Error && e.message === 'archived_sources' ? 'ملفات هالأسبوع مش موجودة بالنظام. إذا مؤرشفة، المدير بيرجعها من الإعدادات ← الأرشيف والمساحة.' : navigator.onLine ? 'ما زبطت، جرّب مرة ثانية.' : 'هاي بدها إنترنت.', 'danger')
    } finally {
      setBusy(null)
    }
  }

  async function exportAll() {
    if (!batch || !rows) return
    await run('export', async () => {
      const sources = await weekSources(batch.id)
      if (!sources.length || sources.some(s => !s.source)) throw new Error('archived_sources')
      const out = await exportWeek(sources.map((s) => ({ name: s.name, source: s.source, col: s.col, sheet: s.sheet, rows: rows.filter((r) => (r.fileId ?? null) === s.id) })), batch.title)
      await saveFile(out.data, out.name, out.mime)
    }, 'نزل الملف')
  }

  const onSave: Saver = async (row, v) => {
    const patch = await saveReading(row, v, { batch: row.batchId })
    setRows((rs) => rs && rs.map((r) => (r.id === row.id ? { ...r, ...patch, enteredAt: new Date().toISOString() } : r)))
  }

  const printRows = printArea ? sortRows((rows ?? []).filter((r) => r.area === printArea)) : []
  const personOf = (id: string | null) => people.find((p) => p.id === id)

  return (
    <div className="report-page readings">
      <header className="ph">
        <div>
          <h1>القراءات</h1>
          <p className="muted">ارفع كشوفات الأسبوع، وزّع المناطق على الفنيين أو الورق، وبالآخر صدّر الكشوفات للشركة معبّأة.</p>
        </div>
        <div className="ph-actions">
          <input ref={fileRef} type="file" accept=".xlsx,.xlsm" multiple hidden onChange={(e) => void pickFiles(e.target.files)} />
          <Button variant="primary" icon={<FileUp size={18} />} busy={busy === 'read'} disabled={!online} onClick={() => fileRef.current?.click()}>رفع ملفات الأسبوع</Button>
        </div>
      </header>
      <SyncBanner />

      {batches && batches.length > 0 && (
        <div className="rd-batches" role="tablist" aria-label="الأسابيع">
          {batches.map((b) => (
            <button key={b.id} type="button" role="tab" aria-selected={b.id === batchId} onClick={() => { setBatchId(b.id); setOpenArea(null) }}>
              <b>{b.title}</b>
              <small className="num">{new Date(b.createdAt).toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' })}{b.status === 'approved' ? ' · معتمد' : ''}</small>
            </button>
          ))}
        </div>
      )}

      {!batches ? <Skeleton kind="list" />
        : !batch ? <p className="card card-empty">ما في ولا أسبوع لسا. اضغط «رفع ملفات الأسبوع» واختار كشوفات Excel اللي بتبعتها الشركة (بتقدر تختار كلهن مرة وحدة).</p>
        : (
          <>
            <section className="card rd-summary">
              <div className="rd-count"><b className="num">{done}</b><span>من {rows?.length ?? '…'} قراءة · <span className="num">{areas.length}</span> منطقة</span></div>
              <div className="rd-bar"><i style={{ width: `${rows?.length ? Math.round((done / rows.length) * 100) : 0}%` }} /></div>
              <div className="rd-actions">
                <Pill tone={batch.status === 'approved' ? 'ok' : 'info'}>{batch.status === 'approved' ? 'معتمد' : 'مفتوح'}</Pill>
                <Button icon={<FileSpreadsheet size={17} />} aria-expanded={showFiles} onClick={() => setShowFiles((x) => !x)}>الكشوفات <span className="num">{files.length}</span></Button>
                <Button icon={<Download size={17} />} busy={busy === 'export'} disabled={!online || !rows?.length} onClick={() => void exportAll()}>تصدير للشركة</Button>
                {batch.status === 'open'
                  ? <Button icon={<Lock size={17} />} busy={busy === 'status'} disabled={!online} onClick={async () => { if (await confirm({ title: 'اعتماد قراءات الأسبوع؟', message: done < (rows?.length ?? 0) ? `في ${(rows?.length ?? 0) - done} مشترك بدون قراءة.` : 'بعد الاعتماد ما حدا من الفنيين بيقدر يعدّل.' })) void run('status', async () => { await setBatchStatus(batch.id, 'approved'); await loadBatches() }, 'انعتمد الأسبوع') }}>اعتماد</Button>
                  : <Button icon={<Unlock size={17} />} busy={busy === 'status'} disabled={!online} onClick={() => void run('status', async () => { await setBatchStatus(batch.id, 'open'); await loadBatches() }, 'انفتح الأسبوع للتعديل')}>إعادة فتح</Button>}
                <Button variant="ghost" icon={<Trash2 size={17} />} disabled={!online || busy !== null} onClick={async () => { if (await confirm({ title: `حذف «${batch.title}»؟`, message: 'بتنحذف كل كشوفاته وقراءاته. ما في رجوع.', danger: true, confirmLabel: 'حذف' })) void run('del', async () => { await deleteBatch(batch.id); setBatchId(null); setRows(null); await loadBatches() }, 'انحذف') }}>حذف الأسبوع</Button>
              </div>
              {showFiles && (
                <ul className="rd-files">
                  {files.length === 0 && <li className="muted">ما في كشوفات.</li>}
                  {files.map((f) => (
                    <li key={f.id}>
                      <FileSpreadsheet size={16} /><span>{f.name}</span><small className="num">{f.rows} مشترك</small>
                      <button type="button" className="icon-btn sm" aria-label={`حذف ${f.name}`} disabled={!online || busy !== null} onClick={async () => { if (await confirm({ title: `حذف كشف «${f.name}»؟`, message: `بتنحذف قراءات مشتركينه (${f.rows}).`, danger: true, confirmLabel: 'حذف' })) void run('delf', async () => { await deleteFile(f.id); await loadRows(batch.id) }, 'انحذف الكشف') }}><Trash2 size={15} /></button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {!rows ? <Skeleton kind="list" /> : (
              <div className="rd-area-grid">
                {areas.map((a) => {
                  const pct = Math.round((a.done / a.total) * 100)
                  const person = a.mode === 'app' ? personOf(a.assigneeId) : undefined
                  return (
                    <article key={a.area} className={`card rd-area-card${openArea === a.area ? ' open' : ''}${a.done === a.total ? ' full' : ''}`}>
                      <button type="button" className="rd-area-top" onClick={() => { setOpenArea(a.area); setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60) }}>
                        <span className="ico-round brand"><Gauge size={17} /></span>
                        <span className="rd-area-t"><b>{a.area}</b><small>{a.boards.length} {a.boards.length === 1 ? 'طبلون' : 'طبالين'} · <span className="num">{a.total}</span> مشترك</small></span>
                      </button>
                      <div className="rd-area-p">
                        <div className="rd-bar"><i style={{ width: `${pct}%` }} /></div>
                        <span className="num">{a.done}/{a.total}</span>
                      </div>
                      <button type="button" className={`rd-who-btn${a.mixed ? ' mixed' : a.mode === 'paper' ? ' paper' : person ? ' tech' : ' none'}`} disabled={batch.status === 'approved'} onClick={() => setAssignFor(a)}>
                        {a.mixed ? <><Users size={18} /><span>مقسومة · اختار من جديد</span></>
                          : a.mode === 'paper' ? <><FileText size={18} /><span>ورق · بتنعبى من المكتب</span></>
                          : person ? <><Avatar name={person.fullName} size={30} /><span><b>{person.fullName}</b>{!person.pages?.includes('readings') && <small>بدها صلاحية «القراءات»</small>}</span></>
                          : <><UserPlus size={18} /><span>اختار مين يقرأها</span></>}
                      </button>
                    </article>
                  )
                })}
              </div>
            )}

            {area && rows && (
              <section className="card rd-panel" ref={panelRef} aria-label={`قراءات ${area.area}`}>
                <div className="rd-panel-h">
                  <h2>{area.area}</h2>
                  <Button icon={<Printer size={16} />} onClick={() => { setPrintArea(area.area); setTimeout(() => window.print(), 50) }}>طباعة ورقة المنطقة</Button>
                  <label className="rd-move">
                    <span>نقل طبلون لمنطقة ثانية:</span>
                    <select className="select" defaultValue="" disabled={!online} onChange={(e) => {
                      const board = e.target.value
                      e.target.value = ''
                      if (!board) return
                      setMovingBoard({ board, area: area.area })
                    }}>
                      <option value="">اختار الطبلون</option>
                      {area.boards.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </label>
                  <button type="button" className="icon-btn" aria-label="إغلاق" onClick={() => setOpenArea(null)}><X size={18} /></button>
                </div>
                <ReadingsFlow key={area.area} rows={rows.filter((r) => r.area === area.area)} onSave={onSave} pending={pending} showPhone embedded />
              </section>
            )}
          </>
        )}

      {printArea && (
        <div className="print-sheet rd-print" aria-hidden="true">
          <header className="ps-head">
            <img src="/logo.webp" alt="" className="ps-logo" />
            <div className="ps-title"><b>القراءات الأسبوعية · {printArea}</b><span>{batch?.title}</span></div>
            <div className="ps-date">القارئ: ............</div>
          </header>
          {[...new Set(printRows.map((r) => r.board))].map((b) => (
            <Fragment key={b}>
              <h2>طبلون {b}</h2>
              <table>
                <thead><tr><th>#</th><th className="wide">الاسم</th><th>الجوال</th><th>السابقة</th><th>الحالية</th><th>ملاحظة</th></tr></thead>
                <tbody>
                  {printRows.filter((r) => r.board === b).map((r) => (
                    <tr key={r.id}><td>{parseCode(r.code).seq}{r.fak ? ` (${r.fak})` : ''}</td><td>{r.subscriber}</td><td>{r.phone}</td><td>{fmt(r.prev)}</td><td>{r.reading ?? ''}</td><td>{stateLabel(r.state)}</td></tr>
                  ))}
                </tbody>
              </table>
            </Fragment>
          ))}
        </div>
      )}

      {assignFor && batch && (
        <AssignDialog
          area={assignFor}
          people={people}
          countOf={(id) => areas.filter((x) => x.mode === 'app' && x.assigneeId === id && !x.mixed).length}
          onClose={() => setAssignFor(null)}
          onPick={(mode, id) => {
            const a = assignFor
            setAssignFor(null)
            void run(`as-${a.area}`, async () => { await assignArea(batch.id, a.area, mode, id); await loadRows(batch.id) },
              mode === 'paper' ? `${a.area}: ورق` : mode === 'app' ? `${a.area} صارت مع ${personOf(id)?.fullName ?? ''}` : `${a.area}: بدون تخصيص`)
          }}
        />
      )}

      {picked && (
        <UploadDialog
          picked={picked}
          openWeek={batch && batch.status === 'open' ? batch : null}
          busy={busy === 'save'}
          onClose={() => setPicked(null)}
          onSave={async (target, title) => {
            const good = picked.filter((p) => p.read && !p.dup) as Array<{ name: string; read: ReadFile }>
            setBusy('save')
            try {
              const id = target === 'new' ? await createBatch(title, me.id) : target
              // A board area already in the week keeps the week's spelling.
              const known = new Map<string, string>()
              for (const a of id === batch?.id ? areas : []) known.set(areaKey(a.area), a.area)
              const areaFor = (x: string) => { const k = areaKey(x); if (!known.has(k)) known.set(k, x); return known.get(k)! }
              const n = await addFiles(id, good.map((g) => ({ read: g.read, name: g.name })), me.id, areaFor)
              setPicked(null)
              await loadBatches()
              setBatchId(id)
              await loadRows(id)
              say(`انضاف ${good.length} ${good.length === 1 ? 'كشف' : 'كشوفات'} · ${n} مشترك`)
            } catch {
              say('ما انحفظ. تأكد من الإنترنت وجرّب مرة ثانية.', 'danger')
            } finally {
              setBusy(null)
            }
          }}
        />
      )}
      {movingBoard && <BoardMoveDialog key={`${movingBoard.area}-${movingBoard.board}`} board={movingBoard.board} area={movingBoard.area} areas={areas.map(a => a.area)} busy={busy==='move'} onClose={() => setMovingBoard(null)} onMove={to => { if (!batch) return; const board=movingBoard.board; void run('move',async () => { await moveBoard(batch.id,board,to);await loadRows(batch.id);setMovingBoard(null) },`انتقل طبلون ${board} لمنطقة ${to}`) }} />}
    </div>
  )
}

/** Who reads this area: big tiles, one tap. */
function AssignDialog({ area, people, countOf, onClose, onPick }: { area: AreaSummary; people: Person[]; countOf(id: string): number; onClose(): void; onPick(mode: 'app' | 'paper' | null, id: string | null): void }) {
  const current = area.mixed ? null : area.mode === 'paper' ? 'paper' : area.mode === 'app' ? area.assigneeId : null
  return (
    <Dialog open onClose={onClose} title={`مين يقرأ «${area.area}»؟`} subtitle={`${area.boards.length} ${area.boards.length === 1 ? 'طبلون' : 'طبالين'} · ${area.total} مشترك`} className="rd-assign">
      <div className="rd-pick">
        <button type="button" className="paper" aria-pressed={current === 'paper'} onClick={() => onPick('paper', null)}>
          <span className="rd-pick-ico"><FileText size={22} /></span>
          <span><b>ورق</b><small>بتنطبع وبتنعبى من المكتب</small></span>
        </button>
        {people.map((p) => {
          const n = countOf(p.id)
          const ok = p.pages?.includes('readings')
          return (
            <button key={p.id} type="button" aria-pressed={current === p.id} onClick={() => onPick('app', p.id)}>
              <Avatar name={p.fullName} size={42} />
              <span><b>{p.fullName}</b><small>{ok ? (n ? `معه ${n} ${n === 1 ? 'منطقة' : 'مناطق'}` : 'فاضي') : 'ما عنده صفحة القراءات بعد'}</small></span>
              {current === p.id && <Check size={20} className="rd-pick-on" />}
            </button>
          )
        })}
      </div>
      {people.some((p) => !p.pages?.includes('readings')) && <p className="rd-pick-note">اللي «ما عنده صفحة القراءات» افتحها له من الإعدادات › الصلاحيات عشان تظهر المنطقة على جواله.</p>}
      {current && <button type="button" className="link-btn rd-pick-clear" onClick={() => onPick(null, null)}>شيل التخصيص</button>}
    </Dialog>
  )
}

function UploadDialog({ picked, openWeek, busy, onClose, onSave }: { picked: Picked[]; openWeek: ReadingBatch | null; busy: boolean; onClose(): void; onSave(target: string, title: string): void }) {
  const today = new Date().toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long' })
  const [target, setTarget] = useState<string>(openWeek ? openWeek.id : 'new')
  const [title, setTitle] = useState(`أسبوع ${today}`)
  const good = picked.filter((p) => p.read && !p.dup)
  const total = good.reduce((s, p) => s + p.read!.rows.length, 0)
  return (
    <Dialog
      open
      onClose={onClose}
      title={picked.length === 1 ? 'كشف جديد' : `${picked.length} كشوفات جديدة`}
      subtitle={`${good.length} جاهز · ${total} مشترك`}
      footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button variant="primary" icon={<Check size={18} />} busy={busy} disabled={!good.length || (target === 'new' && !title.trim())} onClick={() => onSave(target, title.trim())}>حفظ</Button></>}
    >
      <div className="rd-upload">
        {openWeek && (
          <div className="rd-seg wide" role="group" aria-label="وين ينحفظوا">
            <button type="button" aria-pressed={target === openWeek.id} onClick={() => setTarget(openWeek.id)}>إضافة لـ«{openWeek.title}»</button>
            <button type="button" aria-pressed={target === 'new'} onClick={() => setTarget('new')}>أسبوع جديد</button>
          </div>
        )}
        {target === 'new' && <label className="field"><span className="label">اسم الأسبوع</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></label>}
        <ul className="rd-upload-files">
          {picked.map((p) => (
            <li key={p.name} className={p.error ? 'bad' : p.dup ? 'dup' : ''}>
              <FileSpreadsheet size={18} />
              <span><b>{p.name}</b><small>{p.error ?? (p.dup ? 'موجود بهالأسبوع من قبل · ما رح ينضاف مرة ثانية' : `${p.read!.rows.length} مشترك · ${[...new Set(p.read!.rows.map((r) => r.area))].join('، ')}${p.read!.skipped.length ? ` · ${p.read!.skipped.length} سطر ما انقرأ` : ''}`)}</small></span>
            </li>
          ))}
        </ul>
        <p className="muted">الطبالين اللي أسماؤها متشابهة بتصير منطقة وحدة (مثلاً «المقبرة» و«شمال المقبرة»)، حتى لو كانوا بكشوفات مختلفة.</p>
      </div>
    </Dialog>
  )
}
