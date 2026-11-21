import type {Action} from '../../data/actions'
import {loadAverage,readBandValues,hasBandValues,valuesDayAverage,type LoadUnit} from '../sheets/loads'
import {loadKva,logLoads,type GeneratorLog} from './model'
export type GeneratorLoadReading={generator_id:number;load_unit:LoadUnit;band_loads:unknown}
/** A display-only projection: never write shared readings back into generation drafts. */
export function displayGeneratorLog(log:GeneratorLog,rows:GeneratorLoadReading[],actions:Action[],cached:GeneratorLoadReading[]=[]):GeneratorLog{
 const entered=rows.find(r=>r.generator_id===log.generatorId)
 const queued=actions.filter(a=>Number(a.row?.p_generator)===log.generatorId)
 const fallback=cached.find(r=>r.generator_id===log.generatorId)
 const source=entered ?? (!log.storedLoads && fallback && hasBandValues(readBandValues(fallback.band_loads))?fallback:undefined)
 if(!source && !queued.length)return log
 const next={...log,loadUnit:source?.load_unit ?? log.loadUnit,loads:[null,null,null] as GeneratorLog['loads'],bandLoads:readBandValues(source?.band_loads ?? log.bandLoads)}
 for(const a of queued){
  const changes=a.row?.p_changes as Record<string,number|null> | undefined
  for(const [k,v] of Object.entries(changes ?? {}))if(/^[0-6]$/.test(k))next.bandLoads[Number(k)]=v
  if(a.row?.p_unit==='A' || a.row?.p_unit==='kW')next.loadUnit=a.row.p_unit
 }
 return next
}
export function generatorLoadSummary(log:GeneratorLog,capacity:number|null|undefined,voltage:number){
 const carried=logLoads(log)
 const peak=carried?Math.max(...carried.loads.filter((v):v is number=>v!==null)):null
 const average=hasBandValues(log.bandLoads)?valuesDayAverage(log.bandLoads):carried?loadAverage(carried.loads):null
 const kva=carried?loadKva(carried.loads,log.loadUnit,voltage):null
 return {peak,average,kva,percent:kva!==null && capacity && capacity>0?kva/capacity*100:null,hourly:!!carried && !carried.byPhase}
}
