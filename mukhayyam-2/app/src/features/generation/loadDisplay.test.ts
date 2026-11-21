import {describe,it,expect} from 'vitest'
import {displayGeneratorLog,generatorLoadSummary} from './loadDisplay'
import {newReport,type Generator} from './model'
import type {Action} from '../../data/actions'
const generator:Generator={id:1,name:'Cat',brand:'Caterpillar',model:null,litersPerHour:null,capacityKva:200,isActive:true,sortOrder:1}
const base=()=>newReport('2026-11-21',[],[generator],'operator',null,'2026-11-21T08:00:00Z').generators[0]!
describe('distribution load display',()=>{
 it('shows shared hourly readings over old phases without mutating the report',()=>{
  const log=base();log.loads=[50,60,70]
  const shown=displayGeneratorLog(log,[{generator_id:1,load_unit:'A',band_loads:[100,200,null,null,null,null,150]}],[])
  expect(generatorLoadSummary(shown,200,230)).toEqual({peak:200,average:150,kva:138,percent:69,hourly:true})
  expect(log.loads).toEqual([50,60,70]);expect(log.bandLoads.every(v=>v===null)).toBe(true)
 })
 it('keeps the actual reading when capacity is missing and never invents a percentage',()=>{
  const shown=displayGeneratorLog(base(),[{generator_id:1,load_unit:'kW',band_loads:[10,null,30,null,null,null,null]}],[])
  const result=generatorLoadSummary(shown,null,230)
  expect(result.peak).toBe(30);expect(result.average).toBe(20);expect(result.percent).toBeNull();expect(result.kva).toBe(112.5)
 })
 it('preserves zero, empty clears and independent generator IDs',()=>{
  const log=base();log.loads=[50,60,70]
  const zero=displayGeneratorLog(log,[{generator_id:1,load_unit:'A',band_loads:[0,null,null,null,null,null,null]}],[])
  expect(generatorLoadSummary(zero,200,230).percent).toBe(0)
  const cleared=displayGeneratorLog(log,[{generator_id:1,load_unit:'A',band_loads:[null,null,null,null,null,null,null]}],[])
  expect(generatorLoadSummary(cleared,200,230).peak).toBeNull()
  expect(displayGeneratorLog(log,[{generator_id:2,load_unit:'A',band_loads:[900]}],[])).toBe(log)
 })
 it('overlays queued cell edits and unit changes on the same generator',()=>{
  const action={id:'queued',label:'Generator load',op:'rpc',table:'generator_load_patch',row:{p_generator:1,p_changes:{'6':80},p_unit:'kW'}} as Action
  const shown=displayGeneratorLog(base(),[{generator_id:1,load_unit:'A',band_loads:[10,null,null,null,null,null,null]}],[action])
  expect(shown.bandLoads[6]).toBe(80);expect(shown.loadUnit).toBe('kW');expect(generatorLoadSummary(shown,200,230).average).toBe(45)
 })
 it('uses cached distribution hours for a local draft but retains historical phases without hours',()=>{
  const log=base();log.loads=[20,30,40]
  expect(generatorLoadSummary(displayGeneratorLog(log,[],[],[{generator_id:1,load_unit:'A',band_loads:[120,null,null,null,null,null,null]}]),200,230).peak).toBe(120)
  expect(displayGeneratorLog(log,[],[],[{generator_id:1,load_unit:'A',band_loads:[null,null,null,null,null,null,null]}])).toBe(log)
 })
})
