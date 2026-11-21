import {useEffect} from 'react'
import {useLiveQuery} from 'dexie-react-hooks'
import {useEmployee} from '../../auth/AuthProvider'
import {getMeta,setMeta} from '../../data/db'
import {getActions,onActionsSent} from '../../data/actions'
import {getSupabase} from '../../data/supabase'
import {isDemo} from '../../config'
import type {GeneratorLoadReading} from './loadDisplay'

/** Read the same dated rows as distribution, independently of generation draft sync. */
export function useDisplayGeneratorLoads(date:string){
 const {id:actor}=useEmployee()
 const key=`generator-load-display:${actor}:${date}`
 const saved=useLiveQuery(()=>getMeta<{key:string;date:string;rows:GeneratorLoadReading[]}>(key),[key])
 const cached=useLiveQuery(async()=>({key,rows:await getMeta<GeneratorLoadReading[]>(`generator-loads:${actor}:${date}`)}),[actor,date,key])
 const actions=useLiveQuery(async()=>({key,rows:(await getActions()).filter(a=>a.op==='rpc' && a.table==='generator_load_patch' && a.row?.p_actor===actor && a.row?.p_date===date)}),[actor,date,key])
 useEffect(()=>{
  let alive=true,sequence=0
  const load=async()=>{
   const sb=getSupabase();if(isDemo || !navigator.onLine || !sb)return
   const request=++sequence
   try{
    const result=await sb.from('generator_load_entries').select('generator_id,load_unit,band_loads').eq('load_date',date)
    if(!result.error && alive && request===sequence)await setMeta(key,{key,date,rows:result.data ?? []})
   }catch{/* Keep the last safe readings and the existing global connection indicator. */}
  }
  void load()
  const sent=onActionsSent(()=>void load()),online=()=>void load()
  const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void load()},8000)
  window.addEventListener('online',online)
  return()=>{alive=false;sent();window.clearInterval(timer);window.removeEventListener('online',online)}
 },[actor,date,key])
 return {rows:saved?.key===key && saved.date===date?saved.rows:[],actions:actions?.key===key?actions.rows:[],cached:cached?.key===key?cached.rows ?? []:[]}
}
