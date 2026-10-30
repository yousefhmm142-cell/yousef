import { describe, expect, it } from 'vitest'
import { taskMessage, smsUrl, whatsappUrl } from './message'
import { durationText, elapsedMinutes, isOverdue, type Task } from './model'

const base: Task = {
  id: 't1', number: 12, typeId: 4, assigneeId: 'e1', createdBy: null, details: 'تبديل ساعة قرب المسجد',
  subscriberName: 'أبو محمد', subscriberPhone: '0599123456', zoneId: 3, location: 'بجانب المخبز', priority: 'urgent',
  expectedMinutes: 30, status: 'sent', sentAt: '2026-10-30T08:00:00Z', seenAt: null, startedAt: null, completedAt: null,
  cancelledAt: null, completionNotes: '', cancelReason: '', linkToken: 'AbCdEfGhIjKlMnOp', createdAt: '2026-10-30T07:59:00Z',
}

describe('task order message', () => {
  it('reads like the order, ending with the finish link', () => {
    const text = taskMessage(base, { type: 'تبديل ساعة', zone: 'الرازي' }, 'https://m2.example/t/AbCdEfGhIjKlMnOp')
    expect(text).toBe(
      'مستعجل: مهمة رقم 12 · تبديل ساعة\nتبديل ساعة قرب المسجد\nالمشترك: أبو محمد · 0599123456\nالمكان: الرازي · بجانب المخبز\nالمدة المتوقعة: 30 د\n\nلما تخلص اضغط هنا:\nhttps://m2.example/t/AbCdEfGhIjKlMnOp',
    )
  })
  it('leaves out empty lines', () => {
    const text = taskMessage({ ...base, details: '', subscriberName: '', subscriberPhone: null, location: '', priority: 'normal' }, { type: 'تفتيش' }, 'L')
    expect(text).toBe('مهمة رقم 12 · تفتيش\nالمدة المتوقعة: 30 د\n\nلما تخلص اضغط هنا:\nL')
  })
  it('builds WhatsApp and SMS links with the Palestinian code', () => {
    expect(whatsappUrl('0599123456', 'أ ب')).toBe('https://wa.me/970599123456?text=%D8%A3%20%D8%A8')
    expect(smsUrl('0569123456', 'x')).toBe('sms:+970569123456?&body=x')
  })
})

describe('task clock', () => {
  it('runs from sending and flags lateness', () => {
    const now = new Date('2026-10-30T08:45:00Z')
    expect(elapsedMinutes(base, now)).toBe(45)
    expect(isOverdue(base, now)).toBe(true)
    expect(isOverdue({ ...base, status: 'done', completedAt: '2026-10-30T08:20:00Z' }, now)).toBe(false)
    expect(elapsedMinutes({ ...base, status: 'done', completedAt: '2026-10-30T08:20:00Z' }, now)).toBe(20)
    expect(durationText(80)).toBe('1 س 20 د')
    expect(durationText(120)).toBe('2 س')
  })
})
