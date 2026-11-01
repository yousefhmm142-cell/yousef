import { useLiveQuery } from 'dexie-react-hooks'
import { Eye, ShieldCheck, Stamp, Tag } from 'lucide-react'
import { useState } from 'react'
import { SheetStateError } from '../sheets/workflow'
import { byRoleThenName, setJobTitle, setPages, setSealsAccess } from '../../data/admin'
import { db } from '../../data/db'
import { formatPhone } from '../../lib/phone'
import { GRANTABLE_PAGES, isManagerRole, roleLabel, type Employee } from '../../types'
import { Avatar, Pill } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'

const errorText: Record<string, string> = {
  offline: 'يحتاج إنترنت. اتصل وحاول مرة أخرى.',
  not_allowed: 'هذه الخطوة للمدير ومسؤول النظام فقط.',
  missing: 'لم يعد هذا الموظف موجوداً. حدّث الصفحة.',
}

/**
 * Inside the settings, for the manager and the admin: for every person, what they are called
 * (the title) and which pages are open to them. Managers decide; nothing needs a developer.
 */
export function PermissionsPage() {
  const toast = useToast()
  const people = useLiveQuery(async () => (await db.employees.toArray()).filter((e) => e.isActive).sort(byRoleThenName), [])
  const [busy, setBusy] = useState<string | null>(null)

  async function run(key: string, job: () => Promise<void>, ok: string) {
    setBusy(key)
    try {
      await job()
      toast(ok)
    } catch (err) {
      toast(errorText[err instanceof SheetStateError ? err.message : ''] ?? 'تعذّر الحفظ. حاول مرة أخرى.', 'danger')
    }
    setBusy(null)
  }

  return (
    <div className="permissions">
      <section className="card">
        <div className="card-h">
          <span className="ico-round brand"><ShieldCheck size={16} /></span>
          <h2>المسمّيات والصفحات المفتوحة لكل شخص</h2>
        </div>
        <ul className="perm-help">
          <li><Tag size={15} aria-hidden="true" /> <b>المسمّى:</b> اكتب ما يُنادى به الشخص (نائب المدير، محاسبة، مشرف...) واضغط حفظ.</li>
          <li><Eye size={15} aria-hidden="true" /> <b>الصفحات:</b> اضغط على الصفحة لتفتحها له للاطلاع فقط، واضغط مرة ثانية لتغلقها. التعديل يبقى حسب دوره.</li>
          <li><Stamp size={15} aria-hidden="true" /> <b>الأختام:</b> تفتح له صفحتي «صرف الأختام» و«سجل الأختام» كاملتين.</li>
        </ul>
      </section>

      {!people ? (
        <div className="loading-block" aria-busy="true" />
      ) : (
        <ul className="perm-cards">
          {people.map((e) => (
            <PersonCard key={e.id} e={e} busy={busy} run={run} />
          ))}
        </ul>
      )}
    </div>
  )
}

function PersonCard({ e, busy, run }: { e: Employee; busy: string | null; run(key: string, job: () => Promise<void>, ok: string): Promise<void> }) {
  const [title, setTitle] = useState(e.jobTitle ?? '')
  const manager = isManagerRole(e.role)
  const pages = e.pages ?? []
  const dirty = title.trim() !== (e.jobTitle ?? '')

  return (
    <li className="perm-card card">
      <div className="perm-who">
        <Avatar name={e.fullName} size={40} />
        <span className="gen-main">
          <b>{e.fullName}</b>
          <small>
            {roleLabel[e.role]}
            {e.phone && <> · <span className="num ltr">{formatPhone(e.phone)}</span></>}
          </small>
        </span>
        {manager && <Pill tone="ok">كل الصفحات</Pill>}
      </div>

      <form
        className="perm-title"
        onSubmit={(ev) => {
          ev.preventDefault()
          void run(`t${e.id}`, () => setJobTitle(e.id, title), 'حُفظ المسمّى')
        }}
      >
        <label>
          <span className="label">المسمّى</span>
          <input className="input" value={title} maxLength={60} placeholder={roleLabel[e.role]} onChange={(ev) => setTitle(ev.target.value)} />
        </label>
        <button type="submit" className="btn secondary" disabled={!dirty || busy === `t${e.id}`}>حفظ</button>
      </form>

      {!manager && (
        <div className="perm-pages" role="group" aria-label={`الصفحات المفتوحة لـ ${e.fullName}`}>
          {GRANTABLE_PAGES.map((p) => {
            const on = pages.includes(p.key)
            return (
              <button
                key={p.key}
                type="button"
                className="perm-chip"
                aria-pressed={on}
                disabled={busy === `${e.id}${p.key}`}
                onClick={() =>
                  void run(`${e.id}${p.key}`, () => setPages(e.id, on ? pages.filter((k) => k !== p.key) : [...pages, p.key]), on ? `أُغلقت ${p.label} عن ${e.fullName}` : `فُتحت ${p.label} لـ ${e.fullName} للاطلاع`)
                }
              >
                {p.label}
              </button>
            )
          })}
          <button
            type="button"
            className="perm-chip seals"
            aria-pressed={!!e.canSeals}
            disabled={busy === `${e.id}seals`}
            onClick={() => void run(`${e.id}seals`, () => setSealsAccess(e.id, !e.canSeals), e.canSeals ? `أُغلقت الأختام عن ${e.fullName}` : `فُتحت الأختام لـ ${e.fullName}`)}
          >
            <Stamp size={14} aria-hidden="true" /> الأختام
          </button>
          {e.canSeals && !e.hasLogin && <Pill tone="warn">بدون رمز دخول</Pill>}
        </div>
      )}
    </li>
  )
}
