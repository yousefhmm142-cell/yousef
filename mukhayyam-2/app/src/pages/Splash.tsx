import { Logo } from '../ui/primitives'

export function Splash() {
  return (
    <div className="splash" role="status" aria-label="جاري التحميل">
      <Logo height={110} />
      <span className="splash-bar" aria-hidden="true" />
    </div>
  )
}
