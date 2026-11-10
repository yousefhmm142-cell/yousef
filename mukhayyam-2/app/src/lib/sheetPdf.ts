// The printed form as a PDF file, made right on the phone, and sent on WhatsApp.
// The form is drawn exactly as it prints (same page rules), photographed, and put into a PDF page by page.
import { saveFile } from './saveFile'

const PX_PER_MM = 96 / 25.4

/** The page rules of the app with its «print» section applied, for a hidden copy of the form. */
function printCss(): string {
  const out: string[] = []
  const walk = (rules: CSSRuleList, inPrint: boolean) => {
    for (const r of Array.from(rules)) {
      if (r instanceof CSSMediaRule) {
        const isPrint = /print/.test(r.media.mediaText)
        if (isPrint || !/prefers-color-scheme|max-width|min-width|hover|pointer/.test(r.media.mediaText)) walk(r.cssRules, inPrint || isPrint)
      } else if (r instanceof CSSPageRule) {
        continue
      } else if (r instanceof CSSStyleRule || r instanceof CSSFontFaceRule || r instanceof CSSKeyframesRule || r.constructor.name.includes('Property')) {
        out.push(r.cssText)
      }
    }
  }
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      walk(sheet.cssRules, false)
    } catch {
      // A style file from another site cannot be read: the app has none.
    }
  }
  return out.join('\n')
}

const bytes = (s: string) => new TextEncoder().encode(s)

/** Pages of JPEG pictures as one PDF. Sizes in points (1/72 inch). */
function makePdf(pages: Array<{ jpeg: Uint8Array; w: number; h: number }>, pageW: number, pageH: number): Blob {
  const parts: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const push = (p: Uint8Array | string) => {
    const b = typeof p === 'string' ? bytes(p) : p
    parts.push(b)
    length += b.length
  }
  const obj = (n: number, body: () => void) => {
    offsets[n] = length
    push(`${n} 0 obj\n`)
    body()
    push('\nendobj\n')
  }
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  const n = pages.length
  // 1 catalog, 2 pages, then per page: page, content, image.
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'))
  obj(2, () => push(`<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`))
  pages.forEach((p, i) => {
    const page = 3 + i * 3
    obj(page, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 ${page + 2} 0 R >> >> /Contents ${page + 1} 0 R >>`))
    const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`
    obj(page + 1, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`))
    obj(page + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`)
      push(p.jpeg)
      push('\nendstream')
    })
  })
  const total = 3 + n * 3
  const xref = length
  push(`xref\n0 ${total}\n0000000000 65535 f \n`)
  for (let i = 1; i < total; i++) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`)
  return new Blob(parts as BlobPart[], { type: 'application/pdf' })
}

/** Draws the printed form (the element with class «print-sheet») and returns it as a PDF. */
export async function sheetToPdf(sheet: HTMLElement): Promise<Blob> {
  const landscape = sheet.classList.contains('landscape')
  const marginMm = landscape ? 10 : 12
  const pageWpx = Math.round((landscape ? 297 : 210) * PX_PER_MM)
  const pageHpx = Math.round((landscape ? 210 : 297) * PX_PER_MM)
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${pageWpx}px;height:${pageHpx}px;border:0;visibility:hidden`
  document.body.appendChild(frame)
  try {
    const doc = frame.contentDocument!
    doc.open()
    doc.write(`<!doctype html><html lang="ar" dir="rtl" data-theme="light"><head><meta charset="utf-8"><style>${printCss()}
      html,body{margin:0;background:#fff!important;color:#000!important}
      .print-sheet{display:block!important}
      #m2-page{box-sizing:border-box;width:${pageWpx}px;padding:${Math.round(marginMm * PX_PER_MM)}px;background:#fff}
      </style></head><body><div id="m2-page"></div></body></html>`)
    doc.close()
    const copy = sheet.cloneNode(true) as HTMLElement
    copy.removeAttribute('aria-hidden')
    doc.getElementById('m2-page')!.appendChild(copy)
    await doc.fonts.ready
    await Promise.all(Array.from(doc.images).map((img) => (img.complete ? Promise.resolve() : new Promise((r) => { img.onload = img.onerror = () => r(null) }))))
    await new Promise((r) => setTimeout(r, 150))

    const { default: html2canvas } = await import('html2canvas-pro')
    const scale = 2
    const full = await html2canvas(doc.getElementById('m2-page')!, { scale, backgroundColor: '#ffffff', logging: false, windowWidth: pageWpx })
    const sliceH = pageHpx * scale
    const count = Math.max(1, Math.ceil(full.height / sliceH))
    const pages: Array<{ jpeg: Uint8Array; w: number; h: number }> = []
    for (let i = 0; i < count; i++) {
      const c = document.createElement('canvas')
      c.width = full.width
      c.height = sliceH
      const g = c.getContext('2d')!
      g.fillStyle = '#fff'
      g.fillRect(0, 0, c.width, c.height)
      g.drawImage(full, 0, i * sliceH, full.width, Math.min(sliceH, full.height - i * sliceH), 0, 0, full.width, Math.min(sliceH, full.height - i * sliceH))
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.92))
      if (!blob) throw new Error('no_picture')
      pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height })
    }
    return makePdf(pages, landscape ? 842 : 595, landscape ? 595 : 842)
  } finally {
    frame.remove()
  }
}

/**
 * Makes the PDF and opens the phone's share list (WhatsApp is in it). Where a computer or the app cannot
 * share a file, the PDF is saved and WhatsApp opens so it can be attached.
 */
export async function sendSheetOnWhatsApp(sheet: HTMLElement, fileName: string, caption: string): Promise<'shared' | 'saved' | 'cancelled'> {
  const pdf = await sheetToPdf(sheet)
  const file = new File([pdf], fileName, { type: 'application/pdf' })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: caption, text: caption })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
    }
  }
  await saveFile(pdf, fileName, 'application/pdf')
  window.open(`https://wa.me/?text=${encodeURIComponent(caption)}`, '_blank', 'noopener')
  return 'saved'
}
