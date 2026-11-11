import { describe, expect, it } from 'vitest'
import { shipmentSections, taskMatrix } from './build'
import type { SiteReport } from '../generation/model'
import type { Task } from '../tasks/model'
import type { Employee } from '../../types'

const emp = (id: string, fullName: string): Employee => ({ id, fullName, phone: null, role: 'technician', isActive: true, tracksAttendance: false })
const task = (id: string, assigneeId: string, typeId: number, createdAt: string): Task => ({
  id, number: 1, typeId, assigneeId, createdBy: null, details: '', subscriberName: '', subscriberPhone: null, zoneId: null, location: '', priority: 'normal',
  expectedMinutes: 30, status: 'done', sentAt: null, seenAt: null, startedAt: null, completedAt: null, cancelledAt: null, completionNotes: '', cancelReason: '', linkToken: id, createdAt,
})

describe('reports', () => {
  it('counts tasks per technician and type with totals', () => {
    const s = taskMatrix(
      [task('a', 'q', 1, ''), task('b', 'q', 1, ''), task('c', 'm', 4, '')],
      [emp('q', 'قصي'), emp('m', 'مجد')],
      [{ id: 1, name: 'شد كوابل', isActive: true, sortOrder: 1 }, { id: 4, name: 'تبديل ساعة', isActive: true, sortOrder: 4 }, { id: 9, name: 'فصل ووصل', isActive: true, sortOrder: 9 }],
      'k', 't',
    )
    expect(s.columns).toEqual(['الفني', 'شد كوابل', 'تبديل ساعة', 'المجموع'])
    expect(s.rows).toEqual([['قصي', 2, null, 2], ['مجد', null, 1, 1]])
    expect(s.total).toEqual(['المجموع', 2, 1, 3])
  })
})

it('credits a shared order to both technicians and sums their contributions',()=>{
 const joint={...task('a','q',1,''),assigneeIds:['q','m']}
 const s=taskMatrix([joint],[emp('q','أحمد'),emp('m','سارة')],[{id:1,name:'تفتيش',isActive:true,sortOrder:1}],'k','t')
 expect(s.rows).toEqual([['أحمد',1,1],['سارة',1,1]])
 expect(s.total).toEqual(['المجموع',2,2])
})

describe('fuel shipments', () => {
  const line = (shipmentNo: string, receivedQty: number | null, supplier = '', unitPrice: number | null = null) => ({
    id: shipmentNo + receivedQty, fuelTypeId: 1, openingBalance: 0, receivedQty, totalQty: null, closingBalance: null, consumption: null, shipmentNo, supplier, unitPrice, notes: '',
  })
  const rep = (reportDate: string, fuel: ReturnType<typeof line>[]) => ({ reportDate, status: 'submitted', fuel } as unknown as SiteReport)
  const types = [{ id: 1, name: 'سولار', isActive: true, sortOrder: 1 }]

  it('flags a missing or repeated shipment number and sums the cost', () => {
    const all = [rep('2026-11-01', [line('14520', 2000, 'الوقود', 6.5)]), rep('2026-11-03', [line('014520', 1000, 'الوقود', 6)]), rep('2026-11-04', [line('', 500)]), rep('2026-11-05', [line('9', 0)])]
    const [s, by] = shipmentSections(all, types, all)
    expect(s!.rows.map((r) => r[7])).toEqual(['الرقم مكرر (2026-11-03)', 'الرقم مكرر (2026-11-01)', 'بدون رقم إرسالية'])
    expect(s!.rows[0]![6]).toBe(13000)
    expect(s!.total![2]).toBe(3500)
    expect(by!.rows[0]).toEqual(['الوقود', 2, 3000, 6.33, 19000])
  })
})
