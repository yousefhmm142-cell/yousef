import {DailyWorkPanel} from './DailyWorkPanel'
import {useDocumentTitle} from '../../lib/useDocumentTitle'
export function DailyTasksPage(){
 useDocumentTitle('كشف إنجاز الفنيين')
 return <div className="tasks daily-tasks-page"><header className="ph"><div><h1>كشف إنجاز الفنيين</h1><p className="muted">اختر اليوم وشوف الشغل المنجز، بختم أو بدون ختم.</p></div></header><section className="card"><DailyWorkPanel /></section></div>
}
