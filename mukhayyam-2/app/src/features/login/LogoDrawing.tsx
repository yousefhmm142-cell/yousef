import {useId,type CSSProperties} from 'react'

// Contours traced from the approved logo.webp; the final image is the original, unchanged asset.
const contours = [
  'M88,244 103,216 108,210 110,204 115,198 117,192 119,191 121,185 123,184 131,168 139,157 146,142 150,138 157,123 161,119 183,78 198,60 211,52 217,50 231,50 244,56 258,71 280,110 281,66 286,54 289,51 478,52 475,61 473,62 463,81 457,88 447,107 443,110 443,112 437,115 425,117 344,117 344,129 470,129 470,132 467,135 462,146 460,147 459,151 457,152 455,158 449,165 447,171 443,175 441,181 432,190 426,192 343,192 342,246 334,253 325,255 276,255 269,253 267,237 262,235 185,234 186,224 190,220 193,212 196,210 198,205 204,199 248,198 218,149 211,157 210,161 208,162 207,166 205,167 201,176 193,187 191,193 178,212 175,220 171,224 168,232 165,234 159,247 149,261 142,264 131,264 113,260 89,251Z',
  'M325,33 329,28 343,23 414,6 452,1 492,1 518,6 532,11 544,18 555,30 559,47 556,60 543,81 525,98 518,102 514,102 511,96 511,81 506,70 493,57 485,54 484,52 480,52 479,50 450,42 427,39 332,41 326,38Z',
  'M66 187C4 223-10 263 33 289C100 335 231 322 350 278C425 254 486 229 531 211',
]
export function LogoDrawing(){
 const id=useId()
 return <svg className="entry-logo-drawing" viewBox="-12 -12 584 350" aria-hidden="true" focusable="false">
  <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff"/><stop offset=".45" stopColor="#E8EAED"/><stop offset=".7" stopColor="#C5CBD2"/><stop offset="1" stopColor="#fff"/></linearGradient></defs>
  <g className="entry-draw-lines" fill="none" strokeLinecap="round" strokeLinejoin="round">
   {contours.map((d,i)=><g key={i} style={{'--trace-delay':`${i*.18}s`} as CSSProperties}>
    <path d={d} className="entry-draw-edge" pathLength="1"/>
    <path d={d} className={`entry-draw-ink${i===2?' accent':''}`} stroke={i===2?'var(--brand-text)':`url(#${id})`} pathLength="1"/>
   </g>)}
  </g>
  <image href="/logo.webp" x="0" y="0" width="560" height="326" className="entry-logo-reveal"/>
 </svg>
}
