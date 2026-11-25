import { describe, expect, it } from 'vitest'
import { preparedNotices, readNoticeIds } from './preparedNotifications'
const notice = { id: 8, at: '2026-11-25T09:00:00Z', task_number: 297, who: 'موظف التجربة', task_id: 'private-unused', subscriber_phone: 'must-not-be-cached' }

describe('preparation notification inputs', () => {
  it('keeps only the safe display fields from RPC or cached rows', () => {
    expect(preparedNotices([notice])).toEqual([{ id: 8, at: notice.at, taskNumber: 297, who: notice.who }])
  })
  it('handles broken storage and non-array server responses without throwing', () => {
    for (const value of [null, undefined, {}, 42, '[]', [null, {}, false, 'old cache']]) expect(preparedNotices(value)).toEqual([])
  })
  it('provides a safe name when a historical actor has no display name', () => {
    for (const who of [null, undefined, 4, {}, '  ']) expect(preparedNotices([{ ...notice, who }])[0]?.who).toBe('النظام')
  })
  it('rejects invalid timestamps and references and deduplicates repeated events', () => {
    expect(preparedNotices([notice, notice, { ...notice, id: 9, at: 'bad date' }, { ...notice, id: -1 }, { ...notice, id: 10, task_number: null }])).toHaveLength(1)
  })
  it('keeps recent notifications first within the bounded menu', () => {
    const rows = preparedNotices(Array.from({ length: 120 }, (_, i) => ({ ...notice, id: i + 1 })))
    expect(rows).toHaveLength(80)
    expect(rows[0]?.id).toBe(120)
    expect(rows[79]?.id).toBe(41)
  })
  it('repairs malformed read markers instead of treating them as notification data', () => {
    expect(readNoticeIds([8, '9', null, 8, -1, Infinity, {}, 10])).toEqual([10, 8])
    expect(readNoticeIds({ id: 8 })).toEqual([])
    expect(readNoticeIds(Array.from({ length: 600 }, (_, i) => i + 1))).toHaveLength(500)
  })
})
