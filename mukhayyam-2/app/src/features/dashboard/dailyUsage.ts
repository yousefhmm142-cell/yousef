import {addDays, isISODate, type ISODate} from '../../lib/dates'
import {reportTotals, type SiteReport} from '../generation/model'

export type UsageRange = 7 | 30 | 90 | 'all'
export interface UsageDay {date: ISODate; fuel: number|null; hours: number|null; received: number|null}
/** Calendar days, including gaps. A recorded zero is different from a missing report. */
export function usageDays(reports: SiteReport[], today: ISODate, range: UsageRange): UsageDay[] {
 const available=reports.filter(r=>r.status!=='draft' && isISODate(r.reportDate) && r.reportDate<=today)
 const byDate=new Map(available.map(r=>[r.reportDate,reportTotals(r)]))
 const first=range==='all' ? available.map(r=>r.reportDate).sort()[0] ?? today : addDays(today,1-range)
 const count=Math.round((Date.parse(today+'T12:00:00Z')-Date.parse(first+'T12:00:00Z'))/86400000)+1
 return Array.from({length:count},(_,i)=>{
  const date=addDays(first,i),v=byDate.get(date)
  return {date,fuel:v?.consumption ?? null,hours:v?.runHours ?? null,received:v?.received ?? null}
 })
}
/** Never join the line across days without a report. Include real zeroes. */
export function usageSegments(days: UsageDay[], metric: 'fuel'|'hours'): number[][] {
 const segments:number[][]=[]
 days.forEach((d,i)=>{if(d[metric]===null)return;if(i===0 || days[i-1]![metric]===null)segments.push([]);segments[segments.length-1]!.push(i)})
 return segments
}
