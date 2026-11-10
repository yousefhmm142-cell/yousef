import { usePageVisible, prefersReducedMotion } from '../../lib/motion'
import { useNow } from '../../lib/useNow'
import { useAttention } from '../../features/dashboard/activity'
const trace = 'M0 28 H90 L105 22 L116 32 L132 8 L148 47 L164 22 L178 28 H300 L405 28 L416 22 L427 32 L443 8 L459 47 L475 22 L489 28 H600'
export function PulseLine() {
  const visible = usePageVisible()
  const now = useNow(60_000)
  const items = useAttention(now)
  const tone = items?.some(i => i.tone === 'danger') ? 'danger' : items?.length ? 'warn' : 'ok'
  return <button type="button" className="fx-pulse card fx-decoration" data-tone={tone} data-paused={!visible || undefined} onClick={() => document.getElementById('today-attention')?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' })}>
    <span><small>نبض الشبكة</small><b>{!items ? 'جاري قراءة حالة اليوم…' : tone === 'danger' ? 'في شي متأخر' : items.length ? `في ${items.length} أشياء بتستنى` : 'كل شي تمام'}</b></span>
    <svg viewBox="0 0 600 56" preserveAspectRatio="none" aria-hidden="true"><path d={trace} fill="none" stroke="currentColor" opacity=".15" /><g className="fx-pulse-trace"><path d={trace} /><path d={trace} transform="translate(600)" /></g></svg>
  </button>
}
