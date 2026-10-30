import { Clock, Pencil, Plus, Zap } from 'lucide-react'
import { useState } from 'react'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { formatAmount } from '../../lib/numbers'
import { Dialog } from '../../ui/Dialog'
import { NumberField, Segmented, TextField } from '../../ui/form'
import { Button, Pill } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { GENERATOR_BRANDS, type Generator } from '../generation/model'
import { ReportStateError, saveGenerator, useGenerators } from '../generation/repo'

const OTHER = '__other__'
const activeOptions = [
  { value: 'on', label: 'فعّال' },
  { value: 'off', label: 'موقوف' },
] as const
const soon = ['الفريق وأرقام الجوالات وحسابات الدخول', 'حدود التنبيهات والدوامات', 'سجل كل التغييرات']

export function SettingsPage() {
  useDocumentTitle('الإعدادات')
  const generators = useGenerators()
  const [editing, setEditing] = useState<Generator | 'new' | null>(null)

  return (
    <div className="settings">
      <header className="ph">
        <div>
          <h1>الإعدادات</h1>
          <p className="muted">ما تضيفه هنا يظهر في تقرير المشغّل كل يوم دون أن يضيفه بنفسه.</p>
        </div>
      </header>

      <section className="card">
        <div className="card-h">
          <span className="ico-round brand"><Zap size={16} /></span>
          <h2>المولدات</h2>
          <Button variant="primary" icon={<Plus size={17} />} onClick={() => setEditing('new')} className="card-h-action">
            إضافة مولد
          </Button>
        </div>
        {!generators ? (
          <div className="loading-block" aria-busy="true" />
        ) : generators.length === 0 ? (
          <p className="card-empty">لا مولدات بعد. أضف أول مولد ليظهر في تقرير اليوم.</p>
        ) : (
          <ul className="gen-list">
            {generators.map((g) => (
              <li key={g.id}>
                <span className="gen-badge num">{g.sortOrder}</span>
                <span className="gen-main">
                  <b>{g.name}</b>
                  <small>
                    {g.brand}
                    {g.model && <span className="num ltr"> · {g.model}</span>}
                    {g.capacityKva && <span className="num"> · {formatAmount(g.capacityKva)} kVA</span>}
                  </small>
                </span>
                {g.isActive ? <Pill tone="ok">فعّال</Pill> : <Pill>موقوف</Pill>}
                <button type="button" className="icon-btn" aria-label={`تعديل ${g.name}`} onClick={() => setEditing(g)}>
                  <Pencil size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-h"><span className="ico-round"><Clock size={16} /></span><h2>تأتي لاحقاً</h2></div>
        <ul className="soon-list">
          {soon.map((s) => <li key={s}>{s}</li>)}
        </ul>
      </section>

      {editing && (
        <GeneratorDialog
          generator={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function GeneratorDialog({ generator, onClose }: { generator: Generator | null; onClose(): void }) {
  const toast = useToast()
  const knownBrand = !generator || (GENERATOR_BRANDS as readonly string[]).includes(generator.brand)
  const [name, setName] = useState(generator?.name ?? '')
  const [brandChoice, setBrandChoice] = useState(generator ? (knownBrand ? generator.brand : OTHER) : '')
  const [customBrand, setCustomBrand] = useState(knownBrand ? '' : generator?.brand ?? '')
  const [model, setModel] = useState(generator?.model ?? '')
  const [capacity, setCapacity] = useState<number | null>(generator?.capacityKva ?? null)
  const [active, setActive] = useState<'on' | 'off'>(generator?.isActive === false ? 'off' : 'on')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const brand = brandChoice === OTHER ? customBrand.trim() : brandChoice

  async function save() {
    if (!name.trim()) return setError('اكتب اسم المولد، مثل «المولد 4».')
    if (!brand) return setError('اختر الماركة أو اكتبها.')
    setBusy(true)
    try {
      await saveGenerator({
        id: generator?.id,
        name,
        brand,
        model: model.trim() || null,
        capacityKva: capacity,
        isActive: active === 'on',
      })
      toast(generator ? 'حُفظ التعديل' : 'أُضيف المولد')
      onClose()
    } catch (e) {
      setError(e instanceof ReportStateError && e.message === 'duplicate_name' ? 'يوجد مولد بهذا الاسم.' : 'تعذّر الحفظ. حاول مرة أخرى.')
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
            {GENERATOR_BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
            <option value={OTHER}>أخرى…</option>
          </select>
        </label>
        {brandChoice === OTHER && <TextField label="اسم الماركة" value={customBrand} onChange={setCustomBrand} />}
        <TextField label="الموديل (اختياري)" value={model} onChange={setModel} />
        <NumberField label="القدرة" unit="kVA" max={5000} value={capacity} onChange={setCapacity} hint="تُستخدم لحساب نسبة الحمل" />
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
