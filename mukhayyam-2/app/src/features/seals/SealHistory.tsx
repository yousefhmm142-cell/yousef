import { useEffect, useRef, useState } from 'react'
import { History, RefreshCw } from 'lucide-react'
import { useEmployee } from '../../auth/AuthProvider'
import { getSupabase } from '../../data/supabase'
import { Dialog } from '../../ui/Dialog'
import { Button } from '../../ui/primitives'
import { fold } from '../tasks/subscribers'

interface HistoryRow {
  id: number
  at: string
  who: string
  text: string
  record_id: string
  table_name: string
}
export function SealHistoryButton({
  table,
  record,
  label = 'سجل العمليات',
}: {
  table?: 'seal_rolls' | 'seal_batches' | 'seals'
  record?: string
  label?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="ghost" icon={<History size={15} />} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && <SealHistory table={table} record={record} onClose={() => setOpen(false)} />}
    </>
  )
}
function SealHistory({ table, record, onClose }: { table?: string; record?: string; onClose(): void }) {
  const me = useEmployee()
  const [mine, setMine] = useState(!record)
  const [rows, setRows] = useState<HistoryRow[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [more, setMore] = useState(false)
  const [reload, setReload] = useState(0)
  const version = useRef(0)
  async function load(before: number | null = null) {
    const sb = getSupabase()
    if (!sb || !navigator.onLine) {
      setError('اتصل بالإنترنت لعرض السجل. العمليات المحفوظة بدون إنترنت تظهر هون بعد المزامنة.')
      return
    }
    setLoading(true)
    setError('')
    const request = version.current
    const res = await sb.rpc('seal_activity', {
      p_table: table ?? null,
      p_record: record ?? null,
      p_actor: mine ? me.id : null,
      p_before: before,
    })
    if (request !== version.current) return
    if (res.error) setError('تعذّر تحميل السجل. حاول مرة ثانية.')
    else {
      const data = (res.data ?? []) as HistoryRow[]
      setRows((old) => (before ? [...old, ...data.filter((r) => !old.some((x) => x.id === r.id))] : data))
      setMore(data.length === 100)
    }
    setLoading(false)
  }
  useEffect(() => {
    let live = true
    version.current++
    setRows([])
    setLoading(true)
    const sb = getSupabase()
    if (!sb || !navigator.onLine) {
      setLoading(false)
      setError('اتصل بالإنترنت لعرض السجل. العمليات المحفوظة بدون إنترنت تظهر هون بعد المزامنة.')
      return
    }
    void sb
      .rpc('seal_activity', {
        p_table: table ?? null,
        p_record: record ?? null,
        p_actor: mine ? me.id : null,
        p_before: null,
      })
      .then((res) => {
        if (!live) return
        setLoading(false)
        if (res.error) setError('تعذّر تحميل السجل. حاول مرة ثانية.')
        else {
          setError('')
          setRows((res.data ?? []) as HistoryRow[])
          setMore((res.data?.length ?? 0) === 100)
        }
      })
    return () => {
      live = false
      version.current++
    }
  }, [table, record, mine, me.id, reload])
  const shown = rows.filter((r) => fold(`${r.who} ${r.text} حركة #${r.id}`).includes(fold(search)))
  return (
    <Dialog
      open
      className="seal-dialog seal-history"
      title="سجل عمليات الأختام"
      subtitle="مرجع كل عملية، مين سجّلها ومتى. السجل القديم يحتفظ بالتعديلات المسجلة سابقاً."
      onClose={onClose}
      footer={
        <Button
          variant="secondary"
          icon={<RefreshCw size={15} />}
          busy={loading}
          onClick={() => setReload((n) => n + 1)}
        >
          تحديث السجل
        </Button>
      }
    >
      <div className="seal-history-tools">
        <label>
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> شغلي فقط
        </label>
        <input
          className="input"
          type="search"
          aria-label="بحث بسجل الأختام"
          placeholder="اسم، رقم ختم أو مرجع…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {error && (
        <p className="banner warn" role="alert">
          {error}
        </p>
      )}
      <ol className="seal-history-list">
        {shown.map((r) => (
          <li key={r.id}>
            <div>
              <b>{r.who}</b>
              <time dateTime={r.at}>
                {new Date(r.at).toLocaleString('ar-EG-u-nu-latn', {
                  timeZone: 'Asia/Gaza',
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </time>
            </div>
            <p>{r.text}</p>
            <small className="num">مرجع الحركة #{r.id}</small>
          </li>
        ))}
      </ol>
      {!loading && !shown.length && !error && (
        <p className="card-empty">لا عمليات تطابق البحث. العمليات الجديدة تنحفظ تلقائياً بعد المزامنة.</p>
      )}
      {loading && <p role="status">جاري تحميل السجل…</p>}
      {more && (
        <Button variant="secondary" disabled={loading} onClick={() => void load(rows[rows.length - 1]?.id ?? null)}>
          تحميل عمليات أقدم
        </Button>
      )}
    </Dialog>
  )
}
