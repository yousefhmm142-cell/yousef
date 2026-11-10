import { Compass, Lock, RefreshCw, TriangleAlert } from 'lucide-react'
import { captureIssue } from '../lib/clientErrors'
import { useEffect,useState,type ReactNode } from 'react'
import { Link, useRouteError } from 'react-router'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { Button } from '../ui/primitives'

function StateView({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  useDocumentTitle(title)
  return (
    <div className="empty state-view">
      <span className="halo" aria-hidden="true">{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  )
}

export function NotFound() {
  return (
    <StateView
      icon={<Compass size={30} />}
      title="الصفحة غير موجودة"
      text="ربما تغيّر الرابط. ارجع للرئيسية وتابع من هناك."
      action={<Link to="/" className="btn primary">الرئيسية</Link>}
    />
  )
}

export function NoAccess() {
  return (
    <StateView
      icon={<Lock size={28} />}
      title="هذه الصفحة ليست ضمن صلاحياتك"
      text="إن كنت تحتاجها، اطلب من مسؤول النظام تعديل دورك."
      action={<Link to="/" className="btn">الرئيسية</Link>}
    />
  )
}

/** Shown when a screen crashes, instead of a blank page. */
export function RouteError() {
  const error = useRouteError()
  const [reference,setReference]=useState('')
  useEffect(()=>{setReference(captureIssue('render',error))},[error])
  return (
    <div className="state-page">
      <StateView
        icon={<TriangleAlert size={28} />}
        title="حدث خطأ غير متوقع"
        text="بياناتك المحفوظة على الجهاز لم تتأثر. أعد تحميل الصفحة، وإن تكرر الخطأ أخبر مسؤول النظام."
        action={
          <Button variant="primary" icon={<RefreshCw size={17} />} onClick={() => window.location.reload()}>
            إعادة التحميل
          </Button>
        }
      />
      {reference && <p className="num">مرجع العطل: {reference.slice(0,8)}</p>}
    </div>
  )
}
