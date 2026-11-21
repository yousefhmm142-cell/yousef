import {Skeleton} from '../../ui/fx/Skeleton'
import {Check,ChevronDown,ClipboardList,Link2,Search,X} from 'lucide-react'
import {useEffect,useId,useRef,useState} from 'react'
import {dayLabel} from './parts'
import {choiceStatus,type SealTaskChoice} from './taskChoices'
export type {SealTaskChoice} from './taskChoices'

export function TaskPicker({technician,value,choices,selectedChoice,loading,error,query,onSearch,onChange}:{technician:string;value:string;choices:SealTaskChoice[];selectedChoice?:SealTaskChoice;loading:boolean;error:boolean;query:string;onSearch(q:string):void;onChange(t:SealTaskChoice|null):void}){
 const [open,setOpen]=useState(false),id=useId(),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),search=useRef<HTMLInputElement>(null)
 const selected=selectedChoice ?? choices.find(t=>t.id===value)
 const close=(focus=false)=>{setOpen(false);if(focus)requestAnimationFrame(()=>trigger.current?.focus({preventScroll:true}))}
 useEffect(()=>{const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false)};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside)},[])
 const pick=(t:SealTaskChoice|null)=>{onChange(t);close(true)}
 const total=Number(choices[0]?.total_count ?? choices.length)
 return <div className="seal-task-picker field" ref={root}>
  <span className="label">مهمة للفني {technician} (اختياري)</span>
  {open?<div className="seal-task-trigger seal-task-search">
   <Search size={19} aria-hidden="true"/>
   <input ref={search} autoFocus aria-label="بحث في المهام" aria-controls={id} aria-expanded={open} autoComplete="off" maxLength={160} placeholder="رقم المهمة، المشترك، العمل أو الطبلون…" value={query} onChange={e=>onSearch(e.target.value)} onKeyDown={e=>{
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true)}
    if(e.key==='ArrowDown'){e.preventDefault();root.current?.querySelector<HTMLButtonElement>('.seal-task-options button')?.focus()}
   }}/>
   {query && <button type="button" className="seal-task-search-action" aria-label="مسح بحث المهام" onClick={()=>{onSearch('');search.current?.focus()}}><X size={17}/></button>}
   <button type="button" className="seal-task-search-action" aria-label="إغلاق قائمة المهام" onClick={()=>close(true)}><ChevronDown size={18} className="turned"/></button>
  </div>:<button ref={trigger} type="button" className="seal-task-trigger" aria-label="اختيار مهمة للفني" aria-expanded={false} aria-controls={id} onClick={()=>{onSearch('');setOpen(true)}} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();onSearch('');setOpen(true)}}}>
   <ClipboardList size={19}/><span>{selected?<><b>{selected.work} · <bdi className="seal-task-selected-number">#{selected.number}</bdi></b><small className="seal-task-subscriber">{selected.subscriber || 'بدون اسم مشترك'}</small></>:<b>{value?'المهمة المرتبطة المحفوظة':'اختار مهمة للفني'}</b>}</span><ChevronDown size={18}/>
  </button>}
  <div className="seal-task-accordion" data-open={open || undefined} aria-hidden={!open} inert={!open}><div id={id} className="seal-task-options" role="group" aria-busy={loading} aria-label={`اختيار مهمة للفني ${technician}`} onKeyDown={e=>{
   if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true)}
   if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const buttons=[...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')],i=buttons.indexOf(document.activeElement as HTMLButtonElement);if(e.key==='ArrowUp' && i===0)search.current?.focus();else buttons[(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus()}
  }}>
   <div className="seal-task-list-head"><b>{technician} والمجهّزة بدون فني</b><small role="status">{query.trim()?`نتائج البحث · ${total}`:`آخر 7 أيام · ${choices.length}`}</small></div>
   <button type="button" tabIndex={open?undefined:-1} className="seal-task-option automatic" aria-pressed={!value} onClick={()=>pick(null)}><Link2 size={17}/><span><b>بدون اختيار مهمة</b><small>بتقدر تكتب الشغل بنفسك؛ الربط التلقائي بظل شغّال عند التطابق.</small></span>{!value && <Check className="seal-task-check" size={17}/>}</button>
   {error && <p role="status">تعذّر تحديث النتائج. المعروض من المهام المحمّلة فقط؛ جرّب لما يرجع النت.</p>}
   {loading?<div className="seal-task-skeleton"><Skeleton kind="list" rows={3}/></div>:!choices.length?<p role="status">{query.trim()?'ما في مهام مطابقة. جرّب اسم أو رقم أو عمل ثاني.':'ما في مهام حديثة حاليًا.'}</p>:choices.map(t=><button key={t.id} type="button" tabIndex={open?undefined:-1} className="seal-task-option" aria-pressed={value===t.id} onClick={()=>pick(t)}>
    <span className="seal-task-number num">#{t.number}</span><span><span className="seal-task-title"><b>{t.work}</b><small className="seal-task-state" data-done={!t.task_status || t.task_status==='done' || undefined}>{choiceStatus(t)}</small></span><span className="seal-task-subscriber">{t.subscriber || 'بدون اسم مشترك'}</span><small>{dayLabel(t.task_on || t.completed_on || '')}{t.board?` · طبلون ${t.board}`:''}</small></span>{value===t.id && <Check className="seal-task-check" size={17}/>}</button>)}
   {!loading && total>choices.length && <p>ظاهر أول {choices.length} من {total} نتيجة؛ اكتب تفاصيل أكثر لتلاقي المهمة المطلوبة.</p>}
  </div></div>
  <small className="field-hint">البحث يشمل كل التواريخ. الاختيار بيعبّي المشترك والشغل والطبلون والتاريخ المتوفّرين فيها.</small>
  {selected?.task_status && selected.task_status!=='done' && <small className="field-hint">{selected.is_prepared?'عند حفظ الختم تُعيّن هذه المهمة لصاحب الختم وتُنجز ويُربط الختم بها معًا.':'عند حفظ الختم تُنجز هذه المهمة تلقائيًا ويُربط الختم بها. بدون نت، تُثبت العملية عند المزامنة.'}</small>}
  {error && !open && <small className="field-error">تعذّر تحميل مهام الفني. بيانات الختم المحفوظة ما تغيّرت.</small>}
 </div>
}
