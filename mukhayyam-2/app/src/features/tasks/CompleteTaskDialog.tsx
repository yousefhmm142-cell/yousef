import {useRef,useState} from 'react'
import {Dialog} from '../../ui/Dialog'
import {Button} from '../../ui/primitives'
import {useToast} from '../../ui/Toast'
import {parseSealNumbers,WORK_CHOICES} from '../seals/model'
import {Chip} from '../../ui/form'
import {completeTaskWithSeals} from './repo'
import type {Task} from './model'
import {newDispatchId} from './sharedSms'
export function CompleteTaskDialog({task,workName,onClose}:{task:Task;workName:string;onClose():void}) {
 const [numbers,setNumbers]=useState(''),[work,setWork]=useState(workName),[board,setBoard]=useState(''),[notes,setNotes]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const request=useRef(newDispatchId()),toast=useToast()
 async function save(){
  if(busy)return
  const parsed=parseSealNumbers(numbers)
  if(parsed.bad.length){setError('كل رقم ختم لازم يكون من 5 إلى 7 خانات.');return}
  const nums=parsed.numbers
  if(numbers.trim() && !nums.length){setError('اكتب أرقام الأختام بشكل صحيح.');return}
  setBusy(true);setError('')
  try{await completeTaskWithSeals(task,nums,notes,work,board,request.current);toast(navigator.onLine?'انحسبت المهمة، والأختام المسجّلة ظهرت عند المحاسبة.':'انحفظ الإنجاز على الجهاز، وبيتزامن لما يرجع النت.');onClose()}catch{setError('ما انحفظ الإنجاز. تأكد إن كل ختم مصروف لهالفني ولسا غير مستخدم؛ لو مسجّل عند المحاسبة اربطه من صفحة الختم.');setBusy(false)}
 }
 return <Dialog open onClose={()=>{if(!busy)onClose()}} title={`إنجاز المهمة ${task.number}`} footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>إلغاء</Button><Button variant="primary" busy={busy} onClick={()=>void save()}>تم الإنجاز</Button></>}>
  <p className="muted">{task.subscriberName} · الختم اختياري، والشغل بدون ختم بينحسب عادي.</p>
  <label className="field"><span className="label">شو انعمل؟</span><input className="input" value={work} onChange={e=>setWork(e.target.value)} /></label>
  <div className="chips">{WORK_CHOICES.map(w=><Chip key={w} pressed={work.split(' + ').includes(w)} onClick={()=>setWork(old=>old.split(' + ').includes(w)?old.split(' + ').filter(x=>x!==w).join(' + '):[old,w].filter(Boolean).join(' + '))}>{w}</Chip>)}</div>
  <label className="field"><span className="label">الأختام المستخدمة (اختياري)</span><input className="input num" inputMode="numeric" value={numbers} onChange={e=>setNumbers(e.target.value)} placeholder="اكتب الأرقام وبين كل ختم مسافة" /></label>
  <label className="field"><span className="label">الطبلون (اختياري)</span><input className="input" value={board} onChange={e=>setBoard(e.target.value)} /></label>
  <label className="field"><span className="label">ملاحظات الإنجاز (اختياري)</span><textarea className="textarea" value={notes} onChange={e=>setNotes(e.target.value)} /></label>
  {error && <p className="field-error" role="alert">{error}</p>}
 </Dialog>
}
