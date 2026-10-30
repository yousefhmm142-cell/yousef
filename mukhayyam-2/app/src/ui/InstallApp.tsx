import { Download, Smartphone } from 'lucide-react'
import { isDemo } from '../config'

export const APK_PATH = '/mukhayyam2.apk'

/** Already running as the installed app (Android app or added to the home screen). */
export const isInstalled = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || document.referrer.startsWith('android-app://')

export const isAndroid = () => /Android/i.test(navigator.userAgent)

/** The Android app download, for Android phones still in the browser. */
export function InstallAppLink() {
  if (isDemo || isInstalled() || !isAndroid()) return null
  return (
    <a className="install-app glass" href={APK_PATH} download>
      <span className="install-ico"><Smartphone size={20} /></span>
      <span>
        <b>حمّل تطبيق الأندرويد</b>
        <small>أيقونة على الشاشة الرئيسية، ويفتح بدون متصفح</small>
      </span>
      <Download size={18} />
    </a>
  )
}
