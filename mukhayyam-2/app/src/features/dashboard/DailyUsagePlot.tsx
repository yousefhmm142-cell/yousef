import {useLayoutEffect,useState} from 'react'
import {describeDay} from '../../lib/dates'
import {formatNumber} from '../../lib/format'
import {usageSegments,type UsageDay} from './dailyUsage'

export const usageDate=(date:string)=>`${date.slice(8)}/${date.slice(5,7)}/${date.slice(0,4)}`
/** Every day has its own readable slot. Only this region scrolls, never the page. */
export function DailyUsagePlot({days,metric,bars=false}:{days:UsageDay[];metric:'fuel'|'hours';bars?:boolean}){
 const [el,setEl]=useState<HTMLDivElement|null>(null),[available,setAvailable]=useState(0)
 useLayoutEffect(()=>{if(!el)return;const update=()=>setAvailable(el.clientWidth);update();const ro=new ResizeObserver(update);ro.observe(el);return()=>ro.disconnect()},[el])
 const unit=metric==='fuel'?'لتر':'ساعة',width=Math.max(available,days.length*56+60),H=310,base=245,top=40
 const max=Math.max(1,...days.map(d=>d[metric]??0))*1.15
 const slot=(width-60)/Math.max(1,days.length),x=(i:number)=>width-30-slot*(i+.5),y=(v:number)=>base-Math.max(0,v)/max*(base-top)
 const known=days.filter(d=>d[metric]!==null),avg=known.length?known.reduce((sum,d)=>sum+d[metric]!,0)/known.length:null
 return <>
  <div className="hc-daily-guide"><span>القيم بـ{unit==='لتر'?'اللتر':'الساعة'} · من الأقدم يمينًا للأحدث يسارًا</span><span>اسحب يمين ويسار لعرض كل الأيام</span></div>
  <div className="hc-daily-scroll" ref={setEl} tabIndex={0} role="region" aria-label={`رسم ${metric==='fuel'?'استهلاك السولار':'مجموع ساعات تشغيل المولدات'} لكل يوم، قابل للتمرير`}>
   <svg width={width} height={H} role="img" aria-label={`كل نقطة أو عمود يمثل يومًا واحدًا، الوحدة ${unit}، والشرطة تعني لا يوجد تقرير`}>
    {[0,1,2,3].map(i=>{const value=max*i/3,py=y(value);return <g key={i}><line className="hc-grid" x1={30} x2={width-30} y1={py} y2={py}/><text className="hc-daily-axis" direction="ltr" x={width-4} y={py-6} textAnchor="end">{formatNumber(value)}</text></g>})}
    {bars && avg!==null && <line className="hc-avg" x1={30} x2={width-30} y1={y(avg)} y2={y(avg)}/>}
    {!bars && usageSegments(days,metric).map((indices,i)=><path key={i} className="hc-daily-line" d={indices.map((index,j)=>`${j?'L':'M'}${x(index)},${y(days[index]![metric]!)}`).join(' ')}/>)}
    {days.map((d,i)=>{const value=d[metric],cx=x(i);return <g key={d.date} className="hc-daily-day">
     <title>{describeDay(d.date).weekday} {usageDate(d.date)}: {value===null?'لا يوجد تقرير':`${formatNumber(value)} ${unit}`}</title>
     {value!==null ? <>{bars?<rect className="hc-daily-bar" x={cx-14} width={28} y={y(value)} height={Math.max(2,base-y(value))} rx={5}/>:<circle className="hc-daily-point" cx={cx} cy={y(value)} r={4}/>}<text className="hc-daily-value num" x={cx} y={y(value)-12} textAnchor="middle">{formatNumber(value)}</text></>:<text className="hc-daily-missing" x={cx} y={base-12} textAnchor="middle">لا تقرير</text>}
     <text className="hc-daily-label" x={cx} y={base+24} textAnchor="middle">{describeDay(d.date).weekday}</text>
     <text className="hc-daily-label num" x={cx} y={base+44} textAnchor="middle">{`${Number(d.date.slice(8))}/${Number(d.date.slice(5,7))}`}</text>
    </g>})}
   </svg>
  </div>
  {bars && avg!==null && <p className="hc-daily-note">الخط المتقطّع: متوسط استهلاك الأيام المسجّلة <b className="num">{formatNumber(avg)} لتر/يوم</b>. الأيام بدون تقرير لا تدخل في المتوسط.</p>}
 </>
}
