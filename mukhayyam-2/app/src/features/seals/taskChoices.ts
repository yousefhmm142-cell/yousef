import {taskSearchText} from '../tasks/search'

export interface SealTaskChoice {id:string;number:number;subscriber:string;work:string;completed_at:string|null;technician_id:string|null;board:string;completed_on:string|null;task_status?:string;task_on?:string;is_prepared?:boolean;total_count?:number}
export const choiceStatus=(t:SealTaskChoice)=>t.is_prepared?'مجهّزة بدون فني':({new:'معيّنة لفني',sent:'مرسلة',seen:'تم الاطلاع',in_progress:'قيد التنفيذ',done:'منجزة'}[t.task_status || 'done'] || 'بانتظار تم')
/** Offline fallback searches only the safe fields already loaded for this seal. */
export function matchesChoice(t:SealTaskChoice,query:string){
 const text=taskSearchText([t.number,t.subscriber,t.work,t.board,t.task_on,t.completed_on,choiceStatus(t)].join(' '))
 return taskSearchText(query).replace(/#/g,'').split(/\s+/).filter(Boolean).every(word=>text.includes(word))
}
