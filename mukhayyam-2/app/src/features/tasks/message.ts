import { durationText, international, type Task, type WaCode } from './model'

/** The private page behind the order, opened by the technician from the message. */
export const taskLink = (token: string, origin = window.location.origin) => `${origin}/t/${token}`

/** The order exactly as the technician reads it in WhatsApp or SMS. */
export function taskMessage(t: Task, names: { type: string; zone?: string | null }, link: string): string {
  const lines: string[] = []
  const flag = t.priority === 'emergency' ? 'طارئ: ' : t.priority === 'urgent' ? 'مستعجل: ' : ''
  lines.push(`${flag}مهمة رقم ${t.number} · ${names.type}`)
  if (t.details.trim()) lines.push(t.details.trim())
  const who = [t.subscriberName.trim(), t.subscriberPhone].filter(Boolean).join(' · ')
  if (who) lines.push(`المشترك: ${who}`)
  const where = [names.zone, t.location.trim()].filter(Boolean).join(' · ')
  if (where) lines.push(`المكان: ${where}`)
  lines.push(`المدة المتوقعة: ${durationText(t.expectedMinutes)}`)
  lines.push('', 'لما تخلص اضغط هنا:', link)
  return lines.join('\n')
}

/**
 * The order as one short SMS (70 Arabic letters = one message, no link): number, job, subscriber,
 * phone and place, dropping the least needed parts until it fits.
 */
export function taskSms(t: Task, names: { type: string; zone?: string | null }): string {
  const flag = t.priority === 'emergency' ? 'طارئ ' : t.priority === 'urgent' ? 'مستعجل ' : ''
  const head = `${flag}مهمة ${t.number}: ${names.type}`
  const who = t.subscriberName.trim().split(/\s+/).slice(0, 2).join(' ')
  const where = [names.zone, t.location.trim()].filter(Boolean).join(' ')
  const parts = [head, who, t.subscriberPhone ?? '', where, t.details.trim()].filter(Boolean)
  const fit = (xs: string[]) => xs.join(' · ')
  // Drop the details, then the place, then cut what is left.
  for (const keep of [parts, parts.filter((p) => p !== t.details.trim()), [head, who, t.subscriberPhone ?? ''].filter(Boolean), [head, t.subscriberPhone ?? ''].filter(Boolean)]) {
    if (fit(keep).length <= 70) return fit(keep)
  }
  return fit([head, t.subscriberPhone ?? ''].filter(Boolean)).slice(0, 70)
}

/**
 * The order as a full SMS from the office phone (مهند): the whole subscriber name and every detail,
 * even if it takes two messages; still no link.
 */
export function taskSmsFull(t: Task, names: { type: string; zone?: string | null }): string {
  const flag = t.priority === 'emergency' ? 'طارئ: ' : t.priority === 'urgent' ? 'مستعجل: ' : ''
  const lines = [`${flag}مهمة ${t.number}: ${names.type}`]
  if (t.details.trim()) lines.push(t.details.trim())
  const who = [t.subscriberName.trim(), t.subscriberPhone].filter(Boolean).join(' ')
  if (who) lines.push(`المشترك: ${who}`)
  const where = [names.zone, t.location.trim()].filter(Boolean).join(' · ')
  if (where) lines.push(`المكان: ${where}`)
  return lines.join('\n')
}

/** WhatsApp only opens the chat with the country code the person registered with (972 for most here). */
export const whatsappUrl = (phone: string, text: string, code: WaCode = 972) => `https://wa.me/${international(phone, code)}?text=${encodeURIComponent(text)}`

/** Works on Android and iPhone alike. */
export const smsUrl = (phone: string, text: string) => `sms:+${international(phone)}?&body=${encodeURIComponent(text)}`
