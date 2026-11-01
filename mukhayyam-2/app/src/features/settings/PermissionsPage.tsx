import { useLiveQuery } from 'dexie-react-hooks'
import { KeyRound, ShieldCheck, Stamp } from 'lucide-react'
import { useState } from 'react'
import { SheetStateError } from '../sheets/workflow'
import { byRoleThenName, setSealsAccess } from '../../data/admin'
import { db } from '../../data/db'
import { formatPhone } from '../../lib/phone'
import { isManagerRole, roleLabel, titleOf, type Employee, type Role } from '../../types'
import { Avatar, Pill } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'

/** What each role opens, as the app enforces it (the database checks the same rules again). */
const roleAccess: Array<{ roles: Role[]; label: string; pages: string }> = [
  { roles: ['admin', 'manager'], label: 'مسؤول النظام والمدير', pages: 'كل الصفحات: التوليد، التوزيع، المهام، الحضور، المخزن، الأختام، التقارير، الصلاحيات، الإعدادات.' },
  { roles: ['generation_operator', 'distribution_supervisor'], label: 'موظف موقع التوليد', pages: 'تقرير التوليد وكشف التوزيع لليوم، وما أرسله سابقاً. لا يرى غيرها.' },
  { roles: ['technician'], label: 'فني', pages: 'مهامه وحضوره فقط.' },
  { roles: ['staff'], label: 'موظف', pages: 'الحضور فقط.' },
]

const errorText: Record<string, string> = {
  offline: 'يحتاج إنترنت. اتصل وحاول مرة أخرى.',
  not_allowed: 'هذه الخطوة للمدير ومسؤول النظام فقط.',
  missing: 'لم يعد هذا الموظف موجوداً. حدّث الصفحة.',
}

/** Page for the manager and the admin only: who can open what, and the extra permissions per person. */
export function PermissionsPage() {
  const toast = useToast()
  const people = useLiveQuery(async () => (await db.employees.toArray()).filter((e) => e.isActive).sort(byRoleThenName), [])
  const [busy, setBusy] = useState<string | null>(null)

  async function toggleSeals(e: Employee) {
    setBusy(e.id)
    try {
      await setSealsAccess(e.id, !e.canSeals)
      toast(!e.canSeals ? `${e.fullName}: فُتحت لها صفحتا الأختام` : `${e.fullName}: أُغلقت صفحتا الأختام`)
    } catch (err) {
      toast(errorText[err instanceof SheetStateError ? err.message : ''] ?? 'تعذّر الحفظ. حاول مرة أخرى.', 'danger')
    }
    setBusy(null)
  }

  // Managers have everything; the switch is for the people whose pages are limited.
  const limited = (people ?? []).filter((e) => !isManagerRole(e.role))

  return (
    <div className="permissions">
      <section className="card">
        <div className="card-h">
          <span className="ico-round brand"><ShieldCheck size={16} /></span>
          <h2>ما يفتحه كل دور</h2>
        </div>
        <ul className="perm-roles">
          {roleAccess.map((r) => (
            <li key={r.label}>
              <b>{r.label}</b>
              <span>{r.pages}</span>
            </li>
          ))}
        </ul>
        <p className="field-hint perm-note">لتغيير دور شخص: الإعدادات ← الفريق وحسابات الدخول ← تعديل.</p>
      </section>

      <section className="card">
        <div className="card-h">
          <span className="ico-round brand"><Stamp size={16} /></span>
          <h2>صلاحية الأختام</h2>
        </div>
        <p className="field-hint perm-note">تفتح للشخص صفحتي «صرف الأختام» و«سجل الأختام» فقط. يحتاج رقم جوال ورمزاً سرياً ليدخل.</p>
        {!people ? (
          <div className="loading-block" aria-busy="true" />
        ) : limited.length === 0 ? (
          <p className="card-empty">لا موظفين بعد. أضفهم من الإعدادات.</p>
        ) : (
          <ul className="gen-list perm-people">
            {limited.map((e) => (
              <li key={e.id}>
                <Avatar name={e.fullName} size={36} />
                <span className="gen-main">
                  <b>{e.fullName}</b>
                  <small>
                    {titleOf(e)}
                    {e.jobTitle && <> · {roleLabel[e.role]}</>}
                    {e.phone && <> · <span className="num ltr">{formatPhone(e.phone)}</span></>}
                  </small>
                </span>
                {e.canSeals && !e.hasLogin && <Pill tone="warn"><KeyRound size={12} /> بدون رمز دخول</Pill>}
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!e.canSeals}
                  aria-label={`صلاحية الأختام لـ ${e.fullName}`}
                  className="perm-switch"
                  data-on={e.canSeals || undefined}
                  disabled={busy === e.id}
                  onClick={() => void toggleSeals(e)}
                >
                  <i aria-hidden="true" />
                  <span>{e.canSeals ? 'مفتوحة' : 'مغلقة'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
