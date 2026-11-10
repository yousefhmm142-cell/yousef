export type EmptyKind = 'pole' | 'tech' | 'bulb' | 'clipboard' | 'lock'
const shapes: Record<EmptyKind, string[]> = {
  pole: [
    'M56 110 V22 H64 V110',
    'M30 34 H90 M35 28 V40 M85 28 V40',
    'M12 44 Q35 68 56 44 M64 44 Q86 68 108 44',
    'M38 110 H82',
    'M50 22 L60 10 L70 22',
  ],
  tech: [
    'M24 60 V52 A36 36 0 0 1 96 52 V60',
    'M18 60 H102 V70 H18Z',
    'M53 19 V48 M67 19 V48',
    'M35 95 L47 83 L63 99 L51 111Z',
    'M61 85 L86 110 M81 80 L105 104',
    'M80 79 L85 70 L96 74 L91 83Z',
  ],
  bulb: [
    'M42 77 C42 68 30 63 30 46 A30 30 0 0 1 90 46 C90 63 78 68 78 77Z',
    'M45 86 H75 M48 95 H72 M53 104 H67',
    'M53 77 V58 L46 49 M67 77 V58 L74 49',
    'M60 5 V11 M16 18 L23 25 M97 25 L104 18 M8 48 H18 M102 48 H112',
  ],
  clipboard: [
    'M42 21 H25 V109 H95 V21 H78',
    'M46 15 H53 A7 7 0 0 1 67 15 H74 V31 H46Z',
    'M40 49 H80 M40 66 H74 M40 83 H63',
    'M85 101 L97 89 L108 100',
  ],
  lock: [
    'M35 50 V34 A25 25 0 0 1 85 34 V50',
    'M25 50 H95 V108 H25Z',
    'M67 76 A7 7 0 1 0 53 76 A7 7 0 1 0 67 76',
    'M60 83 V94',
    'M47 34 A13 13 0 0 1 73 34',
  ],
}
export function EmptyArt({ kind }: { kind: EmptyKind }) {
  return (
    <svg
      className="fx-empty-art fx-decoration"
      viewBox="0 0 120 120"
      fill="none"
      stroke="var(--brand)"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes[kind].map((d, i) => (
        <path key={i} d={d} style={{ animationDelay: `${i * 60}ms` }} />
      ))}
    </svg>
  )
}
