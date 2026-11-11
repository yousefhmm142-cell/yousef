import type { MutableRefObject } from 'react'
import type { Task } from './model'
import { sendSharedTaskSms } from './repo'
import { smsError } from '../sms/repo'
export function newDispatchId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 15) | 64
  bytes[8] = (bytes[8]! & 63) | 128
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
export class SharedSmsError extends Error {}
export async function sendSharedOrder(
  task: Task,
  request: MutableRefObject<string | null>,
): Promise<'company' | 'already'> {
  if (!navigator.onLine) throw new SharedSmsError('إرسال المهمة المشتركة من رصيد الشركة بدّه إنترنت.')
  request.current ??= newDispatchId()
  const res = await sendSharedTaskSms(task, request.current)
  if (res.failed.length) {
    request.current = null
    throw new SharedSmsError(
      `انبعتت لـ ${res.sent + res.already} من ${res.sent + res.already + res.failed.length}. الباقي ما انبعتت: ${smsError(res.failed[0]!.code)}. المحاولة التالية بتبعت للي ما انبعتلهم فقط.`,
    )
  }
  return res.sent ? 'company' : 'already'
}
