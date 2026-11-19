import {useCallback,useEffect,useRef,useState} from 'react'
import {useLiveQuery} from 'dexie-react-hooks'
import {useEmployee} from '../../auth/AuthProvider'
import {getMeta,setMeta,db} from '../../data/db'
import {getActions,onActionsSent,runOrQueue,type Action} from '../../data/actions'
import {getSupabase} from '../../data/supabase'
import {syncSoon} from '../../data/sync'
import {formatAmount} from '../../lib/numbers'
import {advanceOnEnter,Segmented} from '../../ui/form'
import {Skeleton} from '../../ui/fx/Skeleton'
import {BandGrid} from '../sheets/BandGrid'
import {GENERATION_BANDS,LOAD_UNIT_OPTIONS,readBandValues,valuesDayAverage,type LoadUnit} from '../sheets/loads'

type Reading={generator_id:number;name:string;brand:string;capacity_kva:number|null;load_unit:LoadUnit;band_loads:Array<number|null>;editable:boolean}
const RPC='generator_load_patch'
const relevant=(a:Action,date:string,actor:string)=>a.table===RPC && a.row?.p_date===date && a.row?.p_actor===actor
function overlay(rows:Reading[],actions:Action[],date:string,actor:string):Reading[]{
 return rows.map(r=>{
  const next={...r,band_loads:readBandValues(r.band_loads)}
  for(const a of actions.filter(a=>relevant(a,date,actor) && Number(a.row?.p_generator)===r.generator_id)){
   const changes=a.row?.p_changes as Record<string,number|null>
   for(const [k,v] of Object.entries(changes ?? {}))next.band_loads[Number(k)]=v
   if(a.row?.p_unit)next.load_unit=a.row.p_unit as LoadUnit
  }
  return next
 })
}
/** Shared daily readings: one set for all zones, saved independently from report creation. */
export function GeneratorLoadsPanel({date}:{date:string}){
 const me=useEmployee(),actor=me.id,key=`generator-loads:${actor}:${date}`
 const [loading,setLoading]=useState(true),[error,setError]=useState('')
 const alive=useRef(true),writing=useRef(0)
 const cached=useLiveQuery(()=>getMeta<Reading[]>(key),[key])
 const pending=useLiveQuery(async()=>(await getActions()).filter(a=>relevant(a,date,actor)).length,[date,actor],0) ?? 0
 const load=useCallback(async()=>{
  const sb=getSupabase()
  if(!navigator.onLine || !sb){if(alive.current)setLoading(false);return}
  try{
   const res=await sb.rpc('generator_loads_for_day',{p_date:date})
   if(res.error)throw res.error
   if(!alive.current || writing.current)return
   const rows=overlay((res.data ?? []) as Reading[],await getActions(),date,actor)
   await setMeta(key,rows)
   if(alive.current)setError('')
  }catch{if(alive.current)setError('تعذّر تحميل أحمال المولدات. القيم المحفوظة على جهازك باقية؛ جرّب تحديثها.')}
  finally{if(alive.current)setLoading(false)}
 },[date,actor,key])
 useEffect(()=>{
  alive.current=true;void load()
  const online=()=>void load(),sent=onActionsSent(()=>{void load();syncSoon(true)})
  const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void load()},8000)
  window.addEventListener('online',online)
  return()=>{alive.current=false;sent();window.clearInterval(timer);window.removeEventListener('online',online)}
 },[load])
 function change(id:number,changes:Record<string,number|null>,unit:LoadUnit|null=null){
  writing.current++
  void runOrQueue({op:'rpc',table:RPC,quiet:true,label:`أحمال المولدات ${date}`,row:{p_date:date,p_generator:id,p_changes:changes,p_unit:unit,p_operation:crypto.randomUUID(),p_actor:actor}},async()=>{
   await db.transaction('rw',db.meta,async()=>{
    const rows=(await getMeta<Reading[]>(key)) ?? []
    await setMeta(key,rows.map(r=>{
     if(r.generator_id!==id)return r
     const next={...r,band_loads:readBandValues(r.band_loads),load_unit:unit ?? r.load_unit}
     for(const [k,v] of Object.entries(changes))next.band_loads[Number(k)]=v
     return next
    }))
   })
  },{background:true}).catch(()=>{if(alive.current)setError('تعذّر حفظ التعديل على الجهاز. أعد المحاولة قبل مغادرة الصفحة.')}).finally(()=>writing.current--)
 }
 return <section id="generator-loads" className="distribution-generator-loads" onKeyDown={advanceOnEnter} aria-label="أحمال المولدات اليومية">
  <header><h2>أحمال المولدات</h2><p className="muted">تعبئة واحدة لليوم كله، وبتظهر في تقرير التوليد أيضًا.</p><small role="status" className="muted">{pending?'انحفظت على جهازك · بانتظار المزامنة':'كل تعديل بينحفظ لحاله'}</small></header>
  {error && <div className="banner warn" role="status"><p>{error}</p><button type="button" className="btn" onClick={()=>void load()}>تحديث الأحمال</button></div>}
  {!cached?.length ? loading?<Skeleton kind="cards"/>:<p className="muted">{navigator.onLine?'ما في مولدات مسجّلة لهذا اليوم.':'افتح هذا القسم مرة مع الإنترنت لتحميل المولدات.'}</p> : cached.map(r=><fieldset key={r.generator_id} className="fcard gloads" disabled={!r.editable}>
   <header className="gen-head zloads-head"><div><h3 className="fcard-title">{r.name}</h3><small className="muted">{r.brand}{r.capacity_kva?` · ${formatAmount(r.capacity_kva)} kVA`:''}</small></div><Segmented label={`وحدة أحمال ${r.name}`} value={r.load_unit} options={LOAD_UNIT_OPTIONS} onChange={v=>change(r.generator_id,{},v)}/></header>
   {!r.editable && <p className="field-hint">هذا اليوم مغلق. تعديل أحماله من المدير.</p>}
   <BandGrid bands={GENERATION_BANDS} name={r.name} rows={1} values={readBandValues(r.band_loads).map(v=>[v])} max={r.load_unit==='A'?5000:2000} onChange={(b,_row,v)=>change(r.generator_id,{[b]:v})}/>
   <div className="avg-line"><span>متوسط الساعات المكتوبة</span><b className="num">{valuesDayAverage(r.band_loads)===null?'—':`${formatAmount(valuesDayAverage(r.band_loads))} ${r.load_unit==='A'?'أمبير':'كيلوواط'}`}</b></div>
  </fieldset>)}
 </section>
}
