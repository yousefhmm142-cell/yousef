import '@fontsource/almarai/300.css'
import '@fontsource/almarai/400.css'
import '@fontsource/almarai/700.css'
import '@fontsource/almarai/800.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/ui.css'
import './styles/shell.css'
import './styles/pages.css'
import './styles/forms.css'
import './styles/generation.css'
import './styles/distribution.css'
import './styles/tasks.css'
import './styles/attendance.css'
import './styles/reports-base.css'
import './styles/readings.css'
import './styles/seals.css'
import './styles/print.css'
import './styles/fx.css'
import './styles/shell2.css'
import './styles/home2.css'

import { AppErrorBoundary } from './ui/AppErrorBoundary'
import { startErrorCapture } from './lib/clientErrors'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import { registerSW } from 'virtual:pwa-register'
import { router } from './app/router'
import { AuthProvider } from './auth/AuthProvider'
import { ToastProvider } from './ui/Toast'
import { ConfirmProvider } from './ui/Confirm'
import { isDemo } from './config'
import { startUpdateChecks } from './app/update'
import { startSealQueue } from './features/seals/repo'
import { startActions } from './data/actions'

// A page left open across an update may ask for a screen file that the new version replaced:
// load the new version instead of showing an error (at most once a minute, so it never loops).
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  try {
    const last = Number(sessionStorage.getItem('m2-reloaded') ?? 0)
    if (Date.now() - last < 60_000) return
    sessionStorage.setItem('m2-reloaded', String(Date.now()))
  } catch {
    // Reload anyway.
  }
  window.location.reload()
})

// Ask the browser to keep this device's copy (sheets not sent yet) even when the phone runs short
// of space; without it, a full phone may clear site data.
if (!isDemo) void navigator.storage?.persist?.().catch(() => undefined)

// Caches the app on the device so it opens without internet, and updates itself quietly.
// New versions: checked when the app opens, every 30 minutes, and whenever it comes back to the
// screen; the app then reloads by itself into the new version.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return
    const check = () => void registration.update().catch(() => undefined)
    window.setInterval(check, 30 * 60_000)
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check())
  },
})

// A newer site is taken on the next open or refresh, with «جاري تحديث الموقع…» while it loads.
startErrorCapture()
startUpdateChecks()
startSealQueue()
startActions()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary><AuthProvider>
      <ToastProvider>
        <ConfirmProvider>
          <RouterProvider router={router} />
        </ConfirmProvider>
      </ToastProvider>
    </AuthProvider></AppErrorBoundary>
  </StrictMode>,
)
