import {describe,it,expect} from 'vitest'
import type {SiteReport} from '../generation/model'
import {usageDays,usageSegments} from './dailyUsage'
const report=(date:string,fuel:number,hours:number,status:SiteReport['status']='approved')=>({reportDate:date,status,fuel:[{consumption:fuel,receivedQty:0,closingBalance:0}],generators:[{didRun:true,runHours:hours}]} as SiteReport)
describe('daily dashboard figures',()=>{
 it('includes every calendar day, distinguishes zero and gaps, and excludes drafts and future reports',()=>{
  const days=usageDays([report('2026-11-14',100,2.5),report('2026-11-16',0,0),report('2026-11-13',900,5,'draft'),report('2026-11-20',999,9)],'2026-11-17','all')
  expect(days.map(d=>[d.date,d.fuel,d.hours])).toEqual([['2026-11-14',100,2.5],['2026-11-15',null,null],['2026-11-16',0,0],['2026-11-17',null,null]])
  expect(usageSegments(days,'fuel')).toEqual([[0],[2]])
 })
 it('shows an exact calendar range, including empty leading days',()=>{
  const days=usageDays([report('2026-11-17',150,6)],'2026-11-17',7)
  expect(days).toHaveLength(7);expect(days[0]!.date).toBe('2026-11-11');expect(days[6]!.fuel).toBe(150)
  expect(usageDays([],'2026-11-17','all')).toEqual([{date:'2026-11-17',fuel:null,hours:null,received:null}])
 })
 it('sums generator hours and retains real zero points in continuous segments',()=>{
  const r=report('2026-11-16',120,5);r.generators.push({...r.generators[0]!,runHours:7})
  const days=usageDays([r,report('2026-11-17',0,0)],'2026-11-17','all')
  expect(days[0]!.hours).toBe(12);expect(usageSegments(days,'hours')).toEqual([[0,1]])
 })
})
