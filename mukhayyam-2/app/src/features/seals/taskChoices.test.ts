import {describe,it,expect} from 'vitest'
import {choiceStatus,matchesChoice,type SealTaskChoice} from './taskChoices'
const task:SealTaskChoice={id:'a',number:297,subscriber:'أحمد علي',work:'صيانة كابل',completed_at:null,technician_id:'tech',board:'55',completed_on:null,task_on:'2026-11-21',task_status:'sent'}
describe('safe seal task search fallback',()=>{
 it('finds Arabic task numbers and multiple terms across fields',()=>{expect(matchesChoice(task,'#٢٩٧ احمد كابل ٥٥')).toBe(true);expect(matchesChoice(task,'احمد 56')).toBe(false)})
 it('searches date and distinguishes sent, assigned and prepared tasks',()=>{expect(matchesChoice(task,'مرسلة 2026-11-21')).toBe(true);expect(choiceStatus({...task,task_status:'new'})).toBe('معيّنة لفني');expect(choiceStatus({...task,is_prepared:true,technician_id:null})).toBe('مجهّزة بدون فني')})
 it('never treats an unfinished task as completed',()=>{for(const state of ['new','sent','seen','in_progress'])expect(choiceStatus({...task,task_status:state})).not.toBe('منجزة');expect(choiceStatus({...task,task_status:'done'})).toBe('منجزة')})
})
