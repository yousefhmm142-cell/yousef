import { Skeleton } from '../../ui/fx/Skeleton'
import { useLiveQuery } from 'dexie-react-hooks'
import { Droplet, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { saveListItem } from '../../data/admin'
import { db } from '../../data/db'
import { Dialog } from '../../ui/Dialog'
import { Segmented, TextField } from '../../ui/form'
import { Button, Pill } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { bySortOrder } from '../generation/repo'
import type { FuelType } from '../generation/model'
import { SheetStateError } from '../sheets/workflow'

const activeOptions = [
  { value: 'on', label: 'فعّال' },
  { value: 'off', label: 'موقوف' },
] as const

const errText = (e: unknown) =>
  ({ duplicate_name: 'يوجد صنف بهذا الاسم.', offline: 'الحفظ يحتاج إنترنت. اتصل وحاول مرة أخرى.' } as Record<string, string>)[
    e instanceof SheetStateError ? e.message : ''
  ] ?? 'تعذّر الحفظ. حاول مرة أخرى.'

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
        <Skeleton kind="list" />
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
