// Moving to a newer site the moment one is out.
//
// The app is kept on the device so it opens fast and without internet. That copy used to be
// replaced only once every tab was closed. Now, on every open and whenever the app comes back to
// the screen, it asks the server which build is current (/version.json, never cached). If it is
// not this one, a full-screen «جاري تحديث الموقع…» appears, the new copy is taken, and the page
// reloads into it. Nothing is shown when there is no new build. Work typed into forms is already
// saved on the device, so nothing is lost.

declare const __BUILD_ID__: string

let busy = false

function showCurtain() {
  if (document.getElementById('m2-updating')) return
  const el = document.createElement('div')
  el.id = 'm2-updating'
  el.setAttribute('role', 'status')
  el.setAttribute('aria-live', 'polite')
  el.innerHTML = '<span class="m2-upd-spin" aria-hidden="true"></span><b>جاري تحديث الموقع…</b><small>ثوانٍ وتفتح النسخة الجديدة</small>'
  document.body.appendChild(el)
}

async function latestBuild(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const body = (await res.json()) as { id?: string }
    return body.id ?? null
  } catch {
    return null
  }
}

async function dropOldCopy() {
  // The worker that served the old copy, and the copy itself; the page then loads fresh from the server.
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations()) ?? []
    await Promise.all(regs.map((r) => r.unregister()))
  } catch {
    // Reload anyway.
  }
  try {
    const names = await caches.keys()
    await Promise.all(names.filter((n) => !n.includes('excel')).map((n) => caches.delete(n)))
  } catch {
    // Reload anyway.
  }
}

/** Checks for a newer site; when there is one, shows the curtain and reloads into it. */
export async function checkForUpdate() {
  if (busy || import.meta.env.DEV || !navigator.onLine) return
  const latest = await latestBuild()
  if (!latest || latest === __BUILD_ID__) return
  // Never loop: one try per new build in this tab.
  try {
    if (sessionStorage.getItem('m2-update-tried') === latest) return
    sessionStorage.setItem('m2-update-tried', latest)
  } catch {
    // Go on.
  }
  busy = true
  showCurtain()
  await dropOldCopy()
  window.location.reload()
}

export function startUpdateChecks() {
  void checkForUpdate()
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void checkForUpdate())
  window.addEventListener('online', () => void checkForUpdate())
  window.setInterval(() => document.visibilityState === 'visible' && void checkForUpdate(), 5 * 60_000)
}
