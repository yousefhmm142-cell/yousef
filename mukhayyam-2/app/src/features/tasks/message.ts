import { durationText, international, type Task } from './model'

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

export const whatsappUrl = (phone: string, text: string) => `https://wa.me/${international(phone)}?text=${encodeURIComponent(text)}`

/** Works on Android and iPhone alike. */
export const smsUrl = (phone: string, text: string) => `sms:+${international(phone)}?&body=${encodeURIComponent(text)}`
