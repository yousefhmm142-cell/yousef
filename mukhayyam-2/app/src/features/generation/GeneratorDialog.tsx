import { useState } from 'react'
import { Dialog } from '../../ui/Dialog'
import { Chip, NumberField, Segmented, TextField } from '../../ui/form'
import { Button } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { GENERATOR_BRANDS, type Generator } from './model'
import { ReportStateError, saveGenerator } from './repo'

const OTHER = '__other__'
const activeOptions = [
  { value: 'on', label: 'فعّال' },
  { value: 'off', label: 'موقوف' },
] as const

/** Add or edit one generator: from the settings, or straight from the site's report. */
export function GeneratorDialog({ generator, others, onClose, onSaved }: {
  generator: Generator | null
  others: Generator[]
  onClose(): void
  /** Called with the generator's id once it is saved. */
  onSaved?(id: number): void
}) {
  const toast = useToast()
  const knownBrand = !generator || (GENERATOR_BRANDS as readonly string[]).includes(generator.brand)
  const [name, setName] = useState(generator?.name ?? '')
  const [brandChoice, setBrandChoice] = useState(generator ? (knownBrand ? generator.brand : OTHER) : '')
  const [customBrand, setCustomBrand] = useState(knownBrand ? '' : generator?.brand ?? '')
  const [model, setModel] = useState(generator?.model ?? '')
  const [capacity, setCapacity] = useState<number | null>(generator?.capacityKva ?? null)
  const [rate, setRate] = useState<number | null>(generator?.litersPerHour ?? null)
  // Brands already on the site's generators come first, the most common first.
  const usedBrands = Object.entries(others.reduce<Record<string, number>>((m, g) => ({ ...m, [g.brand]: (m[g.brand] ?? 0) + 1 }), {}))
    .sort((a, b) => b[1] - a[1])
    .map(([b]) => b)
  const brandList = [...usedBrands, ...GENERATOR_BRANDS.filter((b) => !usedBrands.includes(b))]
  const [active, setActive] = useState<'on' | 'off'>(generator?.isActive === false ? 'off' : 'on')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const brand = brandChoice === OTHER ? customBrand.trim() : brandChoice

  async function save() {
    if (!name.trim()) return setError('اكتب اسم المولد، مثل «المولد 4».')
    if (!brand) return setError('اختر الماركة أو اكتبها.')
    setBusy(true)
    try {
      const id = await saveGenerator({
        id: generator?.id,
        name,
        brand,
        model: model.trim() || null,
        capacityKva: capacity,
        litersPerHour: rate,
        isActive: active === 'on',
      })
      toast(generator ? 'حُفظ التعديل' : 'أُضيف المولد')
      onSaved?.(id)
      onClose()
    } catch (e) {
      setError(e instanceof ReportStateError && e.message === 'duplicate_name' ? 'يوجد مولد بهذا الاسم.' : e instanceof ReportStateError && e.message === 'offline' ? 'الحفظ يحتاج إنترنت. اتصل وحاول مرة أخرى.' : e instanceof ReportStateError && e.message === 'not_allowed' ? 'لا تملك صلاحية تعديل المولدات.' : 'تعذّر الحفظ. حاول مرة أخرى.')
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={generator ? `تعديل ${generator.name}` : 'إضافة مولد'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>حفظ</Button>
        </>
      }
    >
      <div className="form-grid">
        <TextField label="الاسم" value={name} onChange={setName} placeholder="المولد 4" />
        <label className="field">
          <span className="label">الماركة</span>
          <select className="select" value={brandChoice} onChange={(e) => setBrandChoice(e.target.value)}>
            <option value="" disabled>اختر الماركة</option>
            {brandList.map((b) => <option key={b} value={b}>{b}</option>)}
            <option value={OTHER}>أخرى…</option>
          </select>
        </label>
        {usedBrands.length > 0 && (
          <div className="chips">
            {usedBrands.map((b) => (
              <Chip key={b} pressed={brandChoice === b} onClick={() => setBrandChoice(b)}>{b}</Chip>
            ))}
          </div>
        )}
        {brandChoice === OTHER && <TextField label="اسم الماركة" value={customBrand} onChange={setCustomBrand} />}
        <TextField label="الموديل (اختياري)" value={model} onChange={setModel} />
        <NumberField label="القدرة" unit="kVA" max={5000} value={capacity} onChange={setCapacity} hint="تُستخدم لحساب نسبة الحمل" />
        <NumberField label="معدل استهلاك السولار" unit="لتر/ساعة" max={1000} value={rate} onChange={setRate} hint="ساعات التشغيل × هذا المعدل = الاستهلاك المتوقع، ويُنبَّه المدير إذا اختلف عن المسجّل" />
        <div className="field">
          <span className="label">الحالة</span>
          <Segmented<'on' | 'off'> label="حالة المولد" value={active} options={activeOptions} onChange={setActive} />
          <span className="field-hint">المولد الموقوف لا يظهر في تقرير اليوم.</span>
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  )
}
