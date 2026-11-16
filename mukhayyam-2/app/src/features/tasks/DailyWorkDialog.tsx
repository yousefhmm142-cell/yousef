import {useEffect} from 'react'
import {useEmployee} from '../../auth/AuthProvider'
import {Dialog} from '../../ui/Dialog'
import {DailyWorkPanel} from './DailyWorkPanel'

export function DailyWorkDialog({onClose}:{onClose():void}){
 const me=useEmployee()
 return me.role==='manager'?<ManagerWorkDialog onClose={onClose}/>:null
}
function ManagerWorkDialog({onClose}:{onClose():void}){
 useEffect(()=>{
  document.body.classList.add('printing-daily-modal')
  return ()=>document.body.classList.remove('printing-daily-modal')
 },[])
 return <Dialog open onClose={onClose} className="daily-work-dialog" title="كشف إنجاز الفنيين" subtitle="راجع أي يوم واطبع الكشف بدون ما تطلع من الرئيسية."><DailyWorkPanel printPortal/></Dialog>
}
