import { Clock, LayoutGrid, Pencil, Plus, Zap } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { formatAmount } from '../../lib/numbers'
import { Dialog } from '../../ui/Dialog'
import { Segmented, TextField } from '../../ui/form'
import { Button, Pill } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import type { Generator } from '../generation/model'
import { GeneratorDialog } from '../generation/GeneratorDialog'
import { saveZone, useZones } from '../distribution/repo'
import type { Zone } from '../distribution/model'
import { ReportStateError, useGenerators } from '../generation/repo'
import { BackupCard } from './BackupCard'
import { FuelTypesCard, StockItemsCard } from './StockAndFuelCards'
import { TeamCard } from './TeamCard'
import { PermissionsPage } from './PermissionsPage'

const soon = ['حدود التنبيهات والدوامات', 'سجل كل التغييرات']

export function SettingsPage() {
  useDocumentTitle('الإعدادات')
  const generators = useGenerators()
  const [editing, setEditing] = useState<Generator | 'new' | null>(null)
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'permissions' ? 'permissions' : 'general'

  return (
    <div className="settings">
      <header className="ph">
        <div>
          <h1>الإعدادات</h1>
          <p className="muted">ما تضيفه هنا يظهر عند الجميع. الإعدادات والصلاحيات يراها المدير ومسؤول النظام فقط.</p>
        </div>
      </header>

      <Segmented<'general' | 'permissions'>
        label="أقسام الإعدادات"
        value={tab}
        options={[{ value: 'general', label: 'الإعدادات' }, { value: 'permissions', label: 'الصلاحيات' }]}
        onChange={(v) => setParams(v === 'general' ? {} : { tab: v }, { replace: true })}
      />

      {tab === 'permissions' ? <PermissionsPage /> : <>
      <TeamCard />

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
                    {g.litersPerHour && <span className="num"> · {formatAmount(g.litersPerHour)} لتر/ساعة</span>}
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

      <ZonesCard />

      <FuelTypesCard />

      <StockItemsCard />

      <BackupCard />

      <section className="card">
        <div className="card-h"><span className="ico-round"><Clock size={16} /></span><h2>تأتي لاحقاً</h2></div>
        <ul className="soon-list">
          {soon.map((s) => <li key={s}>{s}</li>)}
        </ul>
      </section>

      </>}

      {editing && (
        <GeneratorDialog
          generator={editing === 'new' ? null : editing}
          others={generators ?? []}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

/** The areas the distribution supervisor reports on, in the order of the paper form. */
function ZonesCard() {
  const zones = useZones()
  const [editing, setEditing] = useState<Zone | 'new' | null>(null)
  return (
    <section className="card">
      <div className="card-h">
        <span className="ico-round brand"><LayoutGrid size={16} /></span>
        <h2>مناطق التوزيع</h2>
        <Button variant="primary" icon={<Plus size={17} />} onClick={() => setEditing('new')} className="card-h-action">
          إضافة منطقة
        </Button>
      </div>
      {!zones ? (
        <div className="loading-block" aria-busy="true" />
      ) : zones.length === 0 ? (
        <p className="card-empty">لا مناطق بعد.</p>
      ) : (
        <ul className="gen-list">
          {zones.map((z) => (
            <li key={z.id}>
              <span className="gen-badge num">{z.sortOrder}</span>
              <span className="gen-main"><b>{z.name}</b></span>
              {z.isActive ? <Pill tone="ok">فعّالة</Pill> : <Pill>موقوفة</Pill>}
              <button type="button" className="icon-btn" aria-label={`تعديل ${z.name}`} onClick={() => setEditing(z)}>
                <Pencil size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && <ZoneDialog zone={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  )
}

const zoneActiveOptions = [
  { value: 'on', label: 'فعّالة' },
  { value: 'off', label: 'موقوفة' },
] as const

function ZoneDialog({ zone, onClose }: { zone: Zone | null; onClose(): void }) {
  const toast = useToast()
  const [name, setName] = useState(zone?.name ?? '')
  const [active, setActive] = useState<'on' | 'off'>(zone?.isActive === false ? 'off' : 'on')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!name.trim()) return setError('اكتب اسم المنطقة.')
    setBusy(true)
    try {
      await saveZone({ id: zone?.id, name, isActive: active === 'on' })
      toast(zone ? 'حُفظ التعديل' : 'أُضيفت المنطقة')
      onClose()
    } catch (e) {
      setError(e instanceof ReportStateError && e.message === 'duplicate_name' ? 'توجد منطقة بهذا الاسم.' : e instanceof ReportStateError && e.message === 'offline' ? 'الحفظ يحتاج إنترنت. اتصل وحاول مرة أخرى.' : 'تعذّر الحفظ. حاول مرة أخرى.')
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={zone ? `تعديل ${zone.name}` : 'إضافة منطقة'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>حفظ</Button>
        </>
      }
    >
      <div className="form-grid">
        <TextField label="الاسم" value={name} onChange={setName} placeholder="مثل: الصفطاوي" />
        <div className="field">
          <span className="label">الحالة</span>
          <Segmented<'on' | 'off'> label="حالة المنطقة" value={active} options={zoneActiveOptions} onChange={setActive} />
          <span className="field-hint">المنطقة الموقوفة لا تظهر في كشف اليوم.</span>
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  )
}
