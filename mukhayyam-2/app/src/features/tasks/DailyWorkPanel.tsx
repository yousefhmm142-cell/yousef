import {TaskPrintSheet} from './TaskPrintSheet'
import {useMemo,useState} from 'react'
import {useLiveQuery} from 'dexie-react-hooks'
import {db} from '../../data/db'
import {addDays,todayISO,describeDay,type ISODate} from '../../lib/dates'
import {Dialog} from '../../ui/Dialog'
import {Button} from '../../ui/primitives'
import {dailyWork,useSealWorkState} from './sealWork'
import {useDayTasks} from './useDayTasks'
import {useTasks,useTaskTypes} from './repo'
import {isAssignedTo,type Task} from './model'
import {toISODate} from '../../lib/dates'
import {ScrollTable} from '../../ui/ScrollTable'
export function DailyWorkPanel({initialDay=todayISO()}:{initialDay?:ISODate}) {
 const [day,setPickedDay]=useState(initialDay),[detail,setDetail]=useState<{name:string;tasks:Task[]}|null>(null)
 const setDay=(v:ISODate)=>{if(v>todayISO())return;setPickedDay(v);setDetail(null)}
 const cached=useTasks(),types=useTaskTypes(),people=useLiveQuery(()=>db.employees.toArray(),[])
 const rows=useDayTasks(day,cached),names=useMemo(()=>people?new Map(people.map(p=>[p.id,p.fullName])):undefined,[people]),sealState=useSealWorkState(day,day,names),lines=sealState.lines
 const result=useMemo(()=>dailyWork(rows.rows.filter(t=>t.status==='done' && !!t.completedAt && toISODate(new Date(t.completedAt))===day),lines.filter(l=>l.date===day),types??[]),[rows.rows,lines,day,types])
 const techs=(people??[]).filter(p=>p.role==='technician' && (p.isActive || result.tasks.some(t=>isAssignedTo(t,p.id)))).sort((a,b)=>a.fullName.localeCompare(b.fullName,'ar'))
 const columns=result.types.filter(ty=>result.tasks.some(t=>t.typeId===ty.id))
 return <div className="daily-work-panel">
  <div className="ph-actions" style={{flexWrap:'wrap'}}>
   <Button variant="secondary" onClick={()=>setDay(addDays(day,-1))}>اليوم السابق</Button>
   <label className="field"><span className="label">يوم الإنجاز · {describeDay(day).weekday}</span><input className="input" type="date" value={day} max={todayISO()} onChange={e=>{if(e.target.value)setDay(e.target.value)}} /></label>
   <Button variant="secondary" disabled={day>=todayISO()} onClick={()=>setDay(addDays(day,1))}>اليوم التالي</Button>
   <Button variant="ghost" disabled={day===todayISO()} onClick={()=>setDay(todayISO())}>اليوم</Button>
   <Button variant="primary" disabled={rows.busy || !rows.ready || !!rows.error || sealState.busy || !!sealState.error} onClick={()=>window.print()}>طباعة الكشف</Button>
  </div>
  <p className="muted">الشغل المنجز بهاليوم فقط؛ الختم المربوط بمهمة ما بينحسب مرة ثانية. اضغط العدد لتشوف التفاصيل.</p>
  {sealState.error && <p className="banner warn">{sealState.error}</p>}
  {rows.error && <p className="banner warn">{rows.error}</p>}
  {rows.busy || sealState.busy ? <p role="status">جاري تحميل كشف اليوم…</p> : <ScrollTable label="كشف إنجاز الفنيين"><table className="report-table"><thead><tr><th>الفني</th>{columns.map(c=><th key={c.id}>{c.name}</th>)}<th>مجموع الأعمال</th></tr></thead><tbody>{techs.map(p=><tr key={p.id}><th>{p.fullName}</th>{columns.map(c=>{const own=result.tasks.filter(t=>isAssignedTo(t,p.id)&&t.typeId===c.id);return <td key={c.id}>{own.length?<button type="button" className="link-btn num" onClick={()=>setDetail({name:p.fullName,tasks:own})}>{own.length}</button>:'—'}</td>})}<td><Button variant="ghost" onClick={()=>setDetail({name:p.fullName,tasks:result.tasks.filter(t=>isAssignedTo(t,p.id))})}>{result.tasks.filter(t=>isAssignedTo(t,p.id)).length}</Button></td></tr>)}</tbody></table></ScrollTable>}
  {detail && <Dialog open onClose={()=>setDetail(null)} title={`إنجاز ${detail.name}`}><div className="rows">{!detail.tasks.length && <p>ما في شغل منجز بهاليوم.</p>}{detail.tasks.map(t=><article className="card" key={t.id}><b>{result.types.find(ty=>ty.id===t.typeId)?.name}{t.number>0?` · مهمة #${t.number}`:' · تسجيل المحاسبة'}</b><p>{t.subscriberName || 'بدون اسم مشترك'}</p><p>{t.usedSeals?.length?`الأختام: ${t.usedSeals.join('، ')}`:'بدون ختم'}</p><p>{t.details}</p>{t.completionNotes && <p>{t.completionNotes}</p>}</article>)}</div></Dialog>}
  <TaskPrintSheet day={day} tasks={result.tasks} employees={people??[]} types={result.types} />
 </div>
}
