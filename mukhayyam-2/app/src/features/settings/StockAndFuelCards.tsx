import { useLiveQuery } from 'dexie-react-hooks'
import { Boxes, Droplet, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { saveListItem } from '../../data/admin'
import { db } from '../../data/db'
import { formatAmount } from '../../lib/numbers'
import { Dialog } from '../../ui/Dialog'
import { NumberField, Segmented, TextField } from '../../ui/form'
import { Button, Pill } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { bySortOrder } from '../generation/repo'
import type { FuelType } from '../generation/model'
import type { StockItem } from '../stock/model'
import { SheetStateError } from '../sheets/workflow'

const activeOptions = [
  { value: 'on', label: 'فعّال' },
  { value: 'off', label: 'موقوف' },
] as const

const errText = (e: unknown) =>
  ({ duplicate_name: 'يوجد صنف بهذا الاسم.', offline: 'الحفظ يحتاج إنترنت. اتصل وحاول مرة أخرى.' } as Record<string, string>)[
    e instanceof SheetStateError ? e.message : ''
  ] ?? 'تعذّر الحفظ. حاول مرة أخرى.'

/** Warehouse items: name, unit and the minimum that raises "below minimum". */
export function StockItemsCard() {
  const items = useLiveQuery(async () => (await db.stockItems.toArray()).sort(bySortOrder), [])
  const [editing, setEditing] = useState<StockItem | 'new' | null>(null)
  return (
    <section className="card">
      <div className="card-h">
        <span className="ico-round brand"><Boxes size={16} /></span>
        <h2>أصناف المخزن</h2>
        <Button variant="primary" icon={<Plus size={17} />} onClick={() => setEditing('new')} className="card-h-action">إضافة صنف</Button>
      </div>
      {!items ? (
        <div className="loading-block" aria-busy="true" />
      ) : items.length === 0 ? (
        <p className="card-empty">لا أصناف بعد.</p>
      ) : (
        <ul className="gen-list">
          {items.map((i) => (
            <li key={i.id}>
              <span className="gen-main">
                <b>{i.name}</b>
                <small>{i.unit} · الحد الأدنى <span className="num">{formatAmount(i.minQty)}</span></small>
              </span>
              {i.isActive ? <Pill tone="ok">فعّال</Pill> : <Pill>موقوف</Pill>}
              <button type="button" className="icon-btn" aria-label={`تعديل ${i.name}`} onClick={() => setEditing(i)}><Pencil size={16} /></button>
            </li>
          ))}
        </ul>
      )}
      {editing && <StockItemDialog item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  )
}

function StockItemDialog({ item, onClose }: { item: StockItem | null; onClose(): void }) {
  const toast = useToast()
  const [name, setName] = useState(item?.name ?? '')
  const [unit, setUnit] = useState(item?.unit ?? 'قطعة')
  const [min, setMin] = useState<number | null>(item?.minQty ?? 0)
  const [active, setActive] = useState<'on' | 'off'>(item?.isActive === false ? 'off' : 'on')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!name.trim()) return setError('اكتب اسم الصنف.')
    if (!unit.trim()) return setError('اكتب الوحدة.')
    setBusy(true)
    try {
      await saveListItem<StockItem>(db.stockItems, 'stock_items', { id: item?.id, name: name.trim(), unit: unit.trim(), minQty: min ?? 0, isActive: active === 'on' }, (x) => ({
        name: x.name,
        unit: x.unit,
        min_qty: x.minQty,
        is_active: x.isActive,
      }))
      toast(item ? 'حُفظ التعديل' : 'أُضيف الصنف')
      onClose()
    } catch (e) {
      setError(errText(e))
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title={item ? `تعديل ${item.name}` : 'إضافة صنف'}
      footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button variant="primary" busy={busy} onClick={() => void save()}>حفظ</Button></>}>
      <div className="form-grid">
        <TextField label="الاسم" value={name} onChange={setName} placeholder="مثل: عداد كهرباء" />
        <div className="two-col">
          <TextField label="الوحدة" value={unit} onChange={setUnit} placeholder="قطعة، متر..." />
          <NumberField label="الحد الأدنى" unit={unit} value={min} onChange={setMin} hint="تحته يظهر «تحت الحد»" />
        </div>
        <div className="field">
          <span className="label">الحالة</span>
          <Segmented<'on' | 'off'> label="حالة الصنف" value={active} options={activeOptions} onChange={setActive} />
          <span className="field-hint">الموقوف لا يظهر للفني ولا في الأرصدة، وتبقى حركاته السابقة.</span>
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  )
}

/** Fuel types listed in the daily generation report. */
export function FuelTypesCard() {
  const fuels = useLiveQuery(async () => (await db.fuelTypes.toArray()).sort(bySortOrder), [])
  const [editing, setEditing] = useState<FuelType | 'new' | null>(null)
  return (
    <section className="card">
      <div className="card-h">
        <span className="ico-round brand"><Droplet size={16} /></span>
        <h2>أنواع الوقود</h2>
        <Button variant="primary" icon={<Plus size={17} />} onClick={() => setEditing('new')} className="card-h-action">إضافة نوع</Button>
      </div>
      {!fuels ? (
        <div className="loading-block" aria-busy="true" />
      ) : (
        <ul className="gen-list">
          {fuels.map((f) => (
            <li key={f.id}>
              <span className="gen-main"><b>{f.name}</b></span>
              {f.isActive ? <Pill tone="ok">فعّال</Pill> : <Pill>موقوف</Pill>}
              <button type="button" className="icon-btn" aria-label={`تعديل ${f.name}`} onClick={() => setEditing(f)}><Pencil size={16} /></button>
            </li>
          ))}
        </ul>
      )}
      {editing && <FuelDialog fuel={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  )
}

function FuelDialog({ fuel, onClose }: { fuel: FuelType | null; onClose(): void }) {
  const toast = useToast()
  const [name, setName] = useState(fuel?.name ?? '')
  const [active, setActive] = useState<'on' | 'off'>(fuel?.isActive === false ? 'off' : 'on')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!name.trim()) return setError('اكتب اسم نوع الوقود.')
    setBusy(true)
    try {
      await saveListItem<FuelType>(db.fuelTypes, 'fuel_types', { id: fuel?.id, name: name.trim(), isActive: active === 'on' }, (x) => ({ name: x.name, is_active: x.isActive }))
      toast(fuel ? 'حُفظ التعديل' : 'أُضيف نوع الوقود')
      onClose()
    } catch (e) {
      setError(errText(e).replace('صنف', 'نوع'))
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title={fuel ? `تعديل ${fuel.name}` : 'إضافة نوع وقود'}
      footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button variant="primary" busy={busy} onClick={() => void save()}>حفظ</Button></>}>
      <div className="form-grid">
        <TextField label="الاسم" value={name} onChange={setName} placeholder="مثل: سولار مصري، بنزين" />
        <div className="field">
          <span className="label">الحالة</span>
          <Segmented<'on' | 'off'> label="حالة نوع الوقود" value={active} options={activeOptions} onChange={setActive} />
          <span className="field-hint">الموقوف لا يظهر في تقرير اليوم.</span>
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  )
}
