import { getSupabase } from '../data/supabase'
import { isDemo } from '../config'
export interface ClientIssue {
  id: string
  at: string
  kind: string
  code: string
  route: string
  location: string
  build: string
  owner: string | null
}
declare const __BUILD_ID__: string
const KEY = 'm2-client-issues-v1'
let owner: string | null = null,
  flushing = false
const codes = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'EvalError',
  'AggregateError',
])
/** No query strings, task/QR tokens, error messages, form contents or user-entered values. */
export function safeRoute(path: string): string {
  const parts = path.split('?')[0]!.split('/').filter(Boolean)
  if (parts[0] === 't' || parts[0] === 'a') return `/${parts[0]}/[private]`
  const allowed = new Set([
    'my-tasks',
    'my-attendance',
    'login',
    'account',
    'settings',
    'permissions',
    'tasks',
    'attendance',
    'seals',
    'reports',
    'readings',
    'generation',
    'distribution',
    'entry',
    'sheet',
    'more',
    'history',
    'recent',
    'log',
    'seal-work',
  ])
  return (
    '/' +
    parts
      .map((p) => (allowed.has(p) ? p : /^\d{4}-\d\d-\d\d$/.test(p) ? ':date' : '[private]'))
      .join('/')
      .slice(0, 119)
  )
}
export function readClientIssues(): ClientIssue[] {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(data) ? data.filter((i) => i && typeof i.id === 'string' && typeof i.at === 'string') : []
  } catch {
    return []
  }
}
// getRandomValues also works on the older phones supported by this app.
function issueId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 15) | 64
  bytes[8] = (bytes[8]! & 63) | 128
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
export function captureIssue(kind: 'render' | 'error' | 'promise', error: unknown): string {
  const code = error instanceof Error && codes.has(error.name) ? error.name : 'Error'
  const location =
    error instanceof Error ? (error.stack?.match(/\/assets\/[\w-]+\.js:\d+:\d+/g) ?? []).slice(0, 3).join(' ') : ''
  const route = safeRoute(window.location.pathname),
    old = readClientIssues()
  const recent = old.find(
    (i) =>
      i.owner === owner &&
      i.kind === kind &&
      i.code === code &&
      i.route === route &&
      Date.now() - Date.parse(i.at) < 60000,
  )
  if (recent) return recent.id
  const item: ClientIssue = {
    id: issueId(),
    at: new Date().toISOString(),
    kind,
    code,
    route,
    location,
    build: __BUILD_ID__.slice(0, 40),
    owner,
  }
  try {
    localStorage.setItem(KEY, JSON.stringify([item, ...old].slice(0, 40)))
  } catch {
    /* A full device must still show the recovery screen. */
  }
  void flushClientIssues()
  return item.id
}
export async function flushClientIssues() {
  if (flushing || !owner || isDemo || !navigator.onLine) return
  const sb = getSupabase()
  if (!sb) return
  flushing = true
  try {
    for (const i of readClientIssues()
      .filter((x) => x.owner === owner)
      .slice()
      .reverse()) {
      const r = await sb.rpc('report_client_issue', {
        p_id: i.id,
        p_kind: i.kind,
        p_code: i.code,
        p_route: i.route,
        p_location: i.location,
        p_build: i.build,
      })
      if (r.error) break
      try {
        localStorage.setItem(KEY, JSON.stringify(readClientIssues().filter((x) => x.id !== i.id)))
      } catch {
        break
      }
    }
  } catch {
    /* Diagnostics never interrupt the employee. */
  } finally {
    flushing = false
  }
}
export function setIssueOwner(id: string | null) {
  owner = id
  void flushClientIssues()
}
export function startErrorCapture() {
  window.addEventListener('error', (e) => {
    if (e.error) captureIssue('error', e.error)
  })
  window.addEventListener('unhandledrejection', (e) => {
    captureIssue('promise', e.reason)
  })
  window.addEventListener('online', () => void flushClientIssues())
}
