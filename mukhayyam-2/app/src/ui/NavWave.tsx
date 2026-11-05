import { useLayoutEffect, useRef } from 'react'
import { useLocation } from 'react-router'

/** One small SVG, animated only when the hovered/focused/active section changes. */
export function NavWave() {
  const svgRef = useRef<SVGSVGElement>(null)
  const position = useRef<{ x: number; half: number } | null>(null)
  const { pathname } = useLocation()

  useLayoutEffect(() => {
    const svg = svgRef.current
    const nav = svg?.parentElement
    const path = svg?.querySelector('path')
    if (!svg || !nav || !path) return
    let frame = 0
    let live = true
    let target: HTMLAnchorElement | null = null
    let geometry = ''
    const active = () => Array.from(nav.querySelectorAll<HTMLAnchorElement>('a.active')).pop() ?? null
    const draw = (x: number, half: number) => {
      const w = nav.clientWidth, h = nav.clientHeight
      if (!w || !h) return
      const y = h - 2, top = Math.max(3, y - 29)
      const left = Math.max(1, Math.min(x - half, w - half * 2 - 1)), right = left + half * 2
      path.setAttribute('d', `M1 ${y} H${left} C${left + half * .6} ${y} ${left + half * .35} ${top} ${left + half} ${top} C${right - half * .35} ${top} ${right - half * .6} ${y} ${right} ${y} H${w - 1}`)
    }
    const move = (link: HTMLAnchorElement | null, animate = true) => {
      const rect = nav.getBoundingClientRect()
      if (!link || !nav.clientWidth || !rect.width) { cancelAnimationFrame(frame); target = link; geometry = ''; svg.style.opacity = '0'; position.current = null; return }
      const scale = rect.width / nav.clientWidth
      const box = link.getBoundingClientRect()
      const end = { x: (box.left + box.width / 2 - rect.left) / scale, half: Math.min(58, Math.max(28, box.width / scale / 2)) }
      const nextGeometry = `${nav.clientWidth}:${nav.clientHeight}:${end.x}:${end.half}`
      // The observer's first callback must not interrupt the route-change animation.
      if (target === link && geometry === nextGeometry) return
      cancelAnimationFrame(frame)
      target = link
      geometry = nextGeometry
      const start = position.current ?? end
      svg.style.opacity = '1'
      if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { position.current = end; draw(end.x, end.half); return }
      const since = performance.now()
      const tick = (now: number) => {
        const t = Math.min(1, (now - since) / 320), ease = 1 - (1 - t) ** 3
        position.current = { x: start.x + (end.x - start.x) * ease, half: start.half + (end.half - start.half) * ease }
        draw(position.current.x, position.current.half)
        if (t < 1) frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    }
    const enter = (e: Event) => {
      const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a') : null
      if (link && nav.contains(link) && link !== target) move(link)
    }
    const leave = () => move(active())
    const blur = (e: FocusEvent) => { if (!(e.relatedTarget instanceof Node) || !nav.contains(e.relatedTarget)) leave() }
    const resize = () => move(target && nav.contains(target) ? target : active(), false)
    move(active())
    nav.addEventListener('pointerover', enter)
    nav.addEventListener('pointerleave', leave)
    nav.addEventListener('focusin', enter)
    nav.addEventListener('focusout', blur)
    window.addEventListener('resize', resize)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    observer?.observe(nav)
    nav.querySelectorAll('a').forEach((link) => observer?.observe(link))
    void document.fonts?.ready.then(() => { if (live) resize() })
    return () => {
      live = false
      cancelAnimationFrame(frame)
      observer?.disconnect()
      nav.removeEventListener('pointerover', enter)
      nav.removeEventListener('pointerleave', leave)
      nav.removeEventListener('focusin', enter)
      nav.removeEventListener('focusout', blur)
      window.removeEventListener('resize', resize)
    }
  }, [pathname])

  return <svg ref={svgRef} className="nav-wave" aria-hidden="true" focusable="false"><path /></svg>
}
