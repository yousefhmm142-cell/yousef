import {useLayoutEffect,useRef,useState} from 'react'
import {NavLink,useLocation} from 'react-router'
import {useReducedMotion} from '../../lib/motion'
import {SealHistoryButton} from './SealHistory'

type Box={x:number;y:number;width:number;height:number}
// Only geometry is retained between route mounts; no user data or persistence.
let previous: {box:Box;container:number}|null=null
const same=(a:Box,b:Box)=>Math.abs(a.x-b.x)<1 && Math.abs(a.y-b.y)<1 && Math.abs(a.width-b.width)<1 && Math.abs(a.height-b.height)<1

export function SealsTabs({canIssue=true}:{canIssue?:boolean}){
 const {pathname}=useLocation(),reduced=useReducedMotion(),ref=useRef<HTMLElement>(null)
 const [pill,setPill]=useState<Box|null>(null)
 useLayoutEffect(()=>{
  const nav=ref.current
  if(!canIssue || !nav)return
  let frame=0,alive=true,last:Box|null=null
  const place=()=>{
   const active=nav.querySelector<HTMLElement>('a.active')
   if(!active || !alive)return
   const next={x:active.offsetLeft,y:active.offsetTop,width:active.offsetWidth,height:active.offsetHeight}
   if(last && same(last,next))return
   const first=last===null,cached=previous,container=nav.parentElement?.clientWidth ?? nav.clientWidth
   last=next;previous={box:next,container}
   cancelAnimationFrame(frame)
   if(first && cached && Math.abs(cached.container-container)<2 && !reduced && document.visibilityState==='visible' && !same(cached.box,next)){
    setPill(cached.box)
    frame=requestAnimationFrame(()=>{if(alive)setPill(next)})
   }else setPill(next)
  }
  place()
  const observer=new ResizeObserver(place)
  observer.observe(nav)
  const active=nav.querySelector('a.active');if(active)observer.observe(active)
  window.addEventListener('resize',place)
  void document.fonts?.ready.then(place)
  return()=>{alive=false;cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',place)}
 },[pathname,reduced,canIssue])
 if(!canIssue)return null
 return <nav ref={ref} className="seals-tabs" aria-label="صفحات الأختام" data-pill={!!pill || undefined}>
  {pill && <span className="seals-tab-pill" aria-hidden="true" style={{width:pill.width,height:pill.height,transform:`translate(${pill.x}px,${pill.y}px)`}}/>}
  <NavLink to="/seals" end>صرف الأختام</NavLink>
  <NavLink to="/seals/recent">آخر ما صُرف</NavLink>
  <NavLink to="/seals/unrecorded">غير المسجّلة</NavLink>
  <NavLink to="/seals/log">تسجيل الأختام والبحث</NavLink>
  <SealHistoryButton/>
 </nav>
}
