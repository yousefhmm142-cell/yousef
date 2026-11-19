import { usePageVisible } from '../../lib/motion'

// The login logo: the original logo.webp, unchanged. It rises in softly, a light runs once across the
// metal, then it floats gently with its shadow on the floor. Only transform and opacity move (smooth on
// old phones); everything stops for «reduce motion» and while the page is hidden.
export function LoginLogo() {
  const visible = usePageVisible()
  return (
    <div className="ll" data-paused={!visible || undefined} role="img" aria-label="شعار أبناء فارس أبو زايد">
      <span className="ll-glow" aria-hidden="true" />
      <span className="ll-floor" aria-hidden="true" />
      <div className="ll-float" aria-hidden="true">
        <div className="ll-enter">
          <img className="ll-img" src="/logo.webp" alt="" width={560} height={326} decoding="async" draggable={false} />
          <span className="ll-sheen"><i /></span>
        </div>
      </div>
    </div>
  )
}
