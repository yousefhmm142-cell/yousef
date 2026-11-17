import {Check,ChevronDown,ClipboardList,Link2} from 'lucide-react'
import {useEffect,useId,useRef,useState} from 'react'
import {dayLabel} from './parts'

export interface SealTaskChoice {id:string;number:number;subscriber:string;work:string;completed_at:string;technician_id:string;board:string;completed_on:string}
export function TaskPicker({technician,value,choices,loading,error,onChange}:{technician:string;value:string;choices:SealTaskChoice[];loading:boolean;error:boolean;onChange(t:SealTaskChoice|null):void}){
 const [open,setOpen]=useState(false),id=useId(),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null)
 const selected=choices.find(t=>t.id===value)
 useEffect(()=>{const close=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false)};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[])
 const pick=(t:SealTaskChoice|null)=>{onChange(t);setOpen(false);trigger.current?.focus()}
 return <div className="seal-task-picker field" ref={root}>
  <span className="label">مهمة من مهام {technician} (اختياري)</span>
  <button ref={trigger} type="button" className="seal-task-trigger" aria-label="اختيار مهمة للفني" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(v=>!v)} onKeyDown={e=>{if(e.key==='Escape' && open){e.preventDefault();e.stopPropagation();setOpen(false)} if(e.key==='ArrowDown'){e.preventDefault();setOpen(true);requestAnimationFrame(()=>root.current?.querySelector<HTMLButtonElement>('.seal-task-options button')?.focus())}}}>
   <ClipboardList size={19}/><span>{selected?<><b>{selected.work} · <bdi>#{selected.number}</bdi></b><small>{selected.subscriber || 'بدون اسم مشترك'}</small></>:<b>{value?'المهمة المرتبطة المحفوظة':'اختار مهمة للفني'}</b>}</span><ChevronDown size={18} className={open?'turned':''}/>
  </button>
  {open && <div id={id} className="seal-task-options" role="group" aria-label={`المهام المنجزة للفني ${technician}`} onKeyDown={e=>{
   if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setOpen(false);trigger.current?.focus()}
   if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const buttons=[...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')],i=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus()}
  }}>
   <div className="seal-task-list-head"><b>{technician}</b><small>آخر المهام المنجزة · {choices.length}</small></div>
   <button type="button" className="seal-task-option automatic" aria-pressed={!value} onClick={()=>pick(null)}><Link2 size={17}/><span><b>بدون اختيار مهمة</b><small>بتقدر تكتب الشغل بنفسك؛ الربط التلقائي بظل شغّال عند التطابق.</small></span>{!value && <Check size={17}/>}</button>
   {loading?<p role="status">جاري تحميل مهام الفني…</p>:error?<p role="status">تعذّر تحميل مهام الفني. جرّب لما يرجع النت.</p>:!choices.length?<p>ما في مهام منجزة لهالفني حاليًا.</p>:choices.map(t=><button key={t.id} type="button" className="seal-task-option" aria-pressed={value===t.id} onClick={()=>pick(t)}>
    <span className="seal-task-number num">#{t.number}</span><span><b>{t.work}</b><span>{t.subscriber || 'بدون اسم مشترك'}</span><small>{dayLabel(t.completed_on)}{t.board?` · طبلون ${t.board}`:''}</small></span>{value===t.id && <Check size={17}/>}</button>)}
  </div>}
  <small className="field-hint">اختيار المهمة بيعبّي المشترك والشغل والطبلون والتاريخ المتوفّرين فيها.</small>
  {error && !open && <small className="field-error">تعذّر تحميل مهام الفني. بيانات الختم المحفوظة ما تغيّرت.</small>}
 </div>
}
