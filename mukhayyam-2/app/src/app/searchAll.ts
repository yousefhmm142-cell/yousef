import { fold, searchSubscribers, type Subscriber } from '../features/tasks/subscribers'
import type { Task } from '../features/tasks/model'
import type { Employee } from '../types'
import type { NavItem } from './nav'

// The global search (Ctrl+K): one box, results grouped. Everything here is from this device, so it
// is instant and works offline; the free-text task search on the server is added by the window.

export interface Hit {
  key: string
  group: 'pages' | 'subscribers' | 'tasks' | 'seals' | 'people'
  title: string
  hint?: string
  to: string
}

export const GROUPS: Array<{ key: Hit['group']; label: string }> = [
  { key: 'pages', label: 'صفحات' },
  { key: 'tasks', label: 'مهام' },
  { key: 'subscribers', label: 'مشتركين' },
  { key: 'seals', label: 'أختام' },
  { key: 'people', label: 'موظفين' },
]

export interface SearchAccess {
  /** The tasks office or a manager: subscribers and tasks. */
  tasks: boolean
  seals: boolean
  manager: boolean
}

const PER_GROUP = 5
const latin = (s: string) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))

export function searchAll(
  query: string,
  data: { nav: NavItem[]; subscribers: Subscriber[]; tasks: Task[]; people: Employee[]; typeName(id: number): string },
  access: SearchAccess,
): Hit[] {
  const q = fold(latin(query)).trim()
  if (!q) return []
  const words = q.split(' ')
  const has = (text: string) => { const t = fold(text); return words.every((w) => t.includes(w)) }
  const out: Hit[] = []

  // Pages: every page this person can open (plus the guide and his account).
  const pages = [...data.nav, { to: '/guide', label: 'دليل الاستخدام' }, { to: '/account', label: 'حسابي' }]
  for (const p of pages.filter((p) => has(p.label)).slice(0, PER_GROUP)) out.push({ key: `p:${p.to}`, group: 'pages', title: p.label, to: p.to })

  // A number: a task (#35 or 35) and, from five digits, a seal.
  const num = /^#?\s*(\d+)$/.exec(q)?.[1]
  if (access.tasks) {
    const byNo = num ? data.tasks.filter((t) => String(t.number) === num) : []
    const byText = num ? [] : data.tasks.filter((t) => has(`${t.subscriberName} ${t.details} ${data.typeName(t.typeId)} ${t.location}`)).sort((a, b) => b.number - a.number)
    for (const t of [...byNo, ...byText].slice(0, PER_GROUP))
      out.push({ key: `t:${t.id}`, group: 'tasks', title: `#${t.number} · ${data.typeName(t.typeId)}`, hint: [t.subscriberName, t.details].filter(Boolean).join(' · '), to: `/tasks?open=${t.id}&q=${encodeURIComponent(`#${t.number}`)}` })
    if (!num)
      for (const s of searchSubscribers(data.subscribers, query, PER_GROUP))
        out.push({ key: `s:${s.n}:${s.b}`, group: 'subscribers', title: s.n, hint: [s.a, s.b && `طبلون ${s.b}`].filter(Boolean).join(' · '), to: `/subscriber?${new URLSearchParams({ name: s.n, ...(s.b ? { board: s.b } : {}), ...(s.p ? { phone: s.p } : {}) })}` })
  }
  if (access.seals && num && num.length >= 5) out.push({ key: `seal:${num}`, group: 'seals', title: `الختم ${num}`, hint: 'ابحث عنه بسجل الأختام', to: `/seals/log?q=${num}` })

  if (access.manager && !num)
    for (const e of data.people.filter((e) => !e.deletedAt && has(e.fullName)).sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar')).slice(0, PER_GROUP))
      out.push({ key: `e:${e.id}`, group: 'people', title: e.fullName, hint: 'الإعدادات › الفريق', to: '/settings' })

  return out
}
