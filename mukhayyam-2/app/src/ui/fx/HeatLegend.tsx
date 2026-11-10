import type { CSSProperties } from 'react'
export function heatStyle(value: number | null, max: number): CSSProperties | undefined {
  return value === null || max <= 0 ? undefined : { '--heat': Math.max(0, value / max) } as CSSProperties
}
export function HeatLegend() { return <span className="fx-heat-legend" aria-label="شدة الحمل من خفيف إلى عالي"><span>خفيف</span><i aria-hidden="true" /><span>عالي</span></span> }
export function Peak({ peak }: { peak: boolean }) { return peak ? <small className="fx-peak">ذروة</small> : null }
