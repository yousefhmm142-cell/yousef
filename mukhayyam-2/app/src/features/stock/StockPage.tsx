import { ArrowDownToLine, ArrowUpFromLine, Boxes, PackageMinus, PackagePlus, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useEmployee } from '../../auth/AuthProvider'
import { useEmployeeNames } from '../generation/repo'
import { todayISO } from '../../lib/dates'
import { formatAmount } from '../../lib/numbers'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { Dialog } from '../../ui/Dialog'
import { NumberField, TextField } from '../../ui/form'
import { Button, Pill } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { gazaDate } from '../attendance/rules'
import { useConfirmTap } from '../sheets/useDraft'
import { stamp } from '../sheets/ui'
import { SheetStateError } from '../sheets/workflow'
import { balances, isLow, type MoveKind, type StockItem } from './model'
import { addMove, deleteMove, useStockItems, useStockMoves } from './repo'

const errText = (e: unknown) =>
  ({ offline: 'يحتاج إنترنت. اتصل وحاول مرة أخرى.', bad_qty: 'اكتب الكمية.' } as Record<string, string>)[e instanceof SheetStateError ? e.message : ''] ??
  'تعذّر الحفظ. حاول مرة أخرى.'

export function StockPage() {
  useDocumentTitle('المخزن')
  const items = useStockItems()
  const moves = useStockMoves()
  const names = useEmployeeNames()
  const [dialog, setDialog] = useState<MoveKind | null>(null)
  const [filter, setFilter] = useState<number | 'all'>('all')
  const bal = useMemo(() => balances(moves ?? []), [moves])
  const active = (items ?? []).filter((i) => i.isActive)
  const low = active.filter((i) => isLow(i, bal.get(i.id) ?? 0))
  const today = todayISO()
  const todayMoves = (moves ?? []).filter((m) => gazaDate(m.at) === today).length
  const itemName = (id: number) => items?.find((i) => i.id === id)
  const shown = (moves ?? []).filter((m) => filter === 'all' || m.itemId === filter).slice(0, 200)

  return (
    <div className="stock">
      <header className="ph">
        <div>
          <h1>المخزن</h1>
          <p className="muted">الرصيد = كل الوارد − كل الصادر. كل حركة مسجّلة باسم من أدخلها، ومواد المهام تُخصم وحدها.</p>
        </div>
        <div className="ph-actions">
          <Button variant="secondary" icon={<PackageMinus size={17} />} onClick={() => setDialog('out')}>صرف يدوي</Button>
          <Button variant="primary" icon={<PackagePlus size={17} />} onClick={() => setDialog('in')}>وارد</Button>
        </div>
      </header>

      <div className="kpis three">
        <div className="kpi hero">
          <div className="kpi-label"><span className="kpi-ico"><Boxes size={16} /></span>الأصناف</div>
          <div className="kpi-value num">{active.length}<small>صنف</small></div>
          <div className="kpi-sub">تُضاف من الإعدادات</div>
        </div>
        <div className="kpi glass" data-tone={low.length ? 'warn' : undefined}>
          <div className="kpi-label"><span className="kpi-ico"><TriangleAlert size={16} /></span>تحت الحد الأدنى</div>
          <div className="kpi-value num">{low.length}</div>
          <div className="kpi-sub">{low.length ? low.map((i) => i.name).join('، ') : 'كل الأصناف متوفرة'}</div>
        </div>
        <div className="kpi glass">
          <div className="kpi-label"><span className="kpi-ico"><ArrowDownToLine size={16} /></span>حركات اليوم</div>
          <div className="kpi-value num">{todayMoves}</div>
          <div className="kpi-sub">وارد وصادر</div>
        </div>
      </div>

      <section className="card">
        <div className="card-h"><h2>الأرصدة</h2></div>
        {!items ? (
          <div className="loading-block" aria-busy="true" />
        ) : active.length === 0 ? (
          <p className="card-empty">لا أصناف بعد. أضفها من الإعدادات.</p>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr><th>الصنف</th><th>الوحدة</th><th>الرصيد</th><th>الحد الأدنى</th><th>الحالة</th></tr>
              </thead>
              <tbody>
                {active.map((i) => {
                  const b = bal.get(i.id) ?? 0
                  return (
                    <tr key={i.id}>
                      <td className="l"><b>{i.name}</b></td>
                      <td>{i.unit}</td>
                      <td className={`num ${b < 0 ? 'neg' : ''}`}><b>{formatAmount(b)}</b></td>
                      <td className="num">{formatAmount(i.minQty)}</td>
                      <td>{isLow(i, b) ? <Pill tone="warn">تحت الحد</Pill> : <Pill tone="ok">متوفر</Pill>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-h">
          <h2>سجل الحركات</h2>
          <select className="select sm card-h-action" aria-label="تصفية الصنف" value={filter} onChange={(e) => setFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
            <option value="all">كل الأصناف</option>
            {(items ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
        {shown.length === 0 ? (
          <p className="card-empty">لا حركات بعد.</p>
        ) : (
          <ul className="moves">
            {shown.map((m) => (
              <MoveRow key={m.id} move={m} item={itemName(m.itemId)} by={m.createdBy ? names.get(m.createdBy) : undefined} />
            ))}
          </ul>
        )}
      </section>

      {dialog && <MoveDialog kind={dialog} items={active} balance={bal} onClose={() => setDialog(null)} />}
    </div>
  )
}

function MoveRow({ move, item, by }: { move: { id: string; kind: MoveKind; qty: number; at: string; ref: string; note: string }; item: StockItem | undefined; by: string | undefined }) {
  const toast = useToast()
  const [armed, arm, disarm] = useConfirmTap()
  return (
    <li className="move">
      <span className={`move-ico ${move.kind}`}>{move.kind === 'in' ? <ArrowDownToLine size={16} /> : <ArrowUpFromLine size={16} />}</span>
      <span className="move-main">
        <b>{item?.name ?? 'صنف'} <span className="num">{move.kind === 'in' ? '+' : '−'}{formatAmount(move.qty)}</span> {item?.unit}</b>
        <small>{[move.note, move.ref].filter(Boolean).join(' · ') || (move.kind === 'in' ? 'وارد' : 'صرف')} · {stamp(move.at)}{by ? ` · ${by}` : ''}</small>
      </span>
      <button type="button" className="icon-btn sm" aria-label="حذف الحركة"
        onClick={() => (armed ? void deleteMove(move.id).then(() => toast('حُذفت الحركة'), (e) => toast(errText(e), 'danger')).finally(disarm) : arm())}>
        <Trash2 size={15} />
      </button>
      {armed && <small className="move-confirm">اضغط مرة ثانية للحذف</small>}
    </li>
  )
}

function MoveDialog({ kind, items, balance, onClose }: { kind: MoveKind; items: StockItem[]; balance: Map<number, number>; onClose(): void }) {
  const me = useEmployee()
  const toast = useToast()
  const [itemId, setItemId] = useState<number | null>(items[0]?.id ?? null)
  const [qty, setQty] = useState<number | null>(null)
  const [ref, setRef] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const item = items.find((i) => i.id === itemId)
  const have = itemId ? balance.get(itemId) ?? 0 : 0

  async function save() {
    if (!itemId) return setError('اختر الصنف.')
    if (!qty || qty <= 0) return setError('اكتب الكمية.')
    if (kind === 'out' && !ref.trim()) return setError('اكتب سبب الصرف.')
    setBusy(true)
    try {
      await addMove({ itemId, kind, qty, ref: ref.trim(), note: kind === 'out' ? 'صرف يدوي' : 'وارد' }, me.id)
      toast(kind === 'in' ? 'سُجّل الوارد' : 'سُجّل الصرف')
      onClose()
    } catch (e) {
      setError(errText(e))
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title={kind === 'in' ? 'وارد للمخزن' : 'صرف يدوي من المخزن'}
      footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button variant="primary" icon={<Plus size={17} />} busy={busy} onClick={() => void save()}>حفظ</Button></>}>
      <div className="form-grid">
        <label className="field">
          <span className="label">الصنف</span>
          <select className="select" value={itemId ?? ''} onChange={(e) => setItemId(Number(e.target.value))}>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          {item && <span className="field-hint num">المتوفر الآن: {formatAmount(have)} {item.unit}</span>}
        </label>
        <NumberField label="الكمية" unit={item?.unit} value={qty} onChange={setQty} />
        {kind === 'out' && qty !== null && qty > have && <p className="field-hint warn">الكمية أكبر من المتوفر في المخزن.</p>}
        <TextField label={kind === 'in' ? 'رقم الفاتورة أو المورّد (اختياري)' : 'السبب'} value={ref} onChange={setRef} />
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  )
}
