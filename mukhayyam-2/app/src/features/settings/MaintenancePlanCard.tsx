import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarClock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { isDemo } from '../../config'
import { db } from '../../data/db'
import { getSupabase } from '../../data/supabase'
import { NumberField } from '../../ui/form'
import { Button } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { defaultMaintenancePlan, maintenanceLabel, type MaintenancePlan, type MaintenanceType } from '../generation/model'

const KINDS: Array<{ kind: MaintenanceType; by: 'hours' | 'days' }> = [
  { kind: 'oil_filter', by: 'hours' },
  { kind: 'fuel_filter', by: 'hours' },
  { kind: 'air_filter', by: 'hours' },
  { kind: 'cooling', by: 'days' },
  { kind: 'battery', by: 'days' },
  { kind: 'belt', by: 'days' },
]

/** Settings: how often each maintenance is due (the schedule on the generation report reads it). */
export function MaintenancePlanCard() {
  const toast = useToast()
  const saved = useLiveQuery(async () => (await db.alertSettings.get(1))?.maintenancePlan ?? defaultMaintenancePlan, [])
  const [plan, setPlan] = useState<MaintenancePlan | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (saved && !plan) setPlan(saved) }, [saved, plan])
  if (!plan) return null

  async function save() {
    setBusy(true)
    try {
      // Only the filled boxes; an empty one means «no schedule for this».
      const clean: MaintenancePlan = {}
      for (const { kind, by } of KINDS) {
        const v = plan![kind]?.[by]
        if (v && v > 0) clean[kind] = { [by]: Math.round(v) }
      }
      const sb = getSupabase()
      if (!isDemo) {
        if (!sb || !navigator.onLine) throw new Error('offline')
        const { error } = await sb.rpc('maintenance_plan_set', { p_plan: clean })
        if (error) throw new Error('failed')
      }
      const cur = await db.alertSettings.get(1)
      if (cur) await db.alertSettings.put({ ...cur, maintenancePlan: clean })
      toast('انحفظ جدول الصيانة')
    } catch (e) {
      toast(e instanceof Error && e.message === 'offline' ? 'الحفظ بدو إنترنت' : 'ما انحفظ. حاول مرة ثانية.', 'danger')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="card-h">
        <span className="ico-round brand"><CalendarClock size={16} /></span>
        <h2>جدول صيانة المولدات</h2>
        <Button variant="primary" busy={busy} onClick={() => void save()} className="card-h-action">حفظ</Button>
      </div>
      <p className="muted mp-note">كل كم ساعة تشغيل أو كل كم يوم لازم تنعمل كل صيانة. فاضي = بدون موعد. تغيير الزيت له إعداده الخاص (250 ساعة).</p>
      <div className="mp-form">
        {KINDS.map(({ kind, by }) => (
          <NumberField
            key={kind}
            label={maintenanceLabel(kind)}
            unit={by === 'hours' ? 'ساعة' : 'يوم'}
            decimal={false}
            max={10000}
            value={plan[kind]?.[by] ?? null}
            onChange={(v) => setPlan((p) => ({ ...p, [kind]: v ? { [by]: v } : undefined }))}
          />
        ))}
      </div>
    </section>
  )
}
