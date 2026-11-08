import { getSupabase } from '../../data/supabase'

// SMS from the company's subscription (هوت SMS). The database sends them; the login never comes here.

export const SMS_ERRORS: Record<string, string> = {
  '1000': 'الرصيد خلص',
  '2000': 'اسم المستخدم أو كلمة السر غلط',
  '3000': 'نوع الرسالة غلط',
  '4000': 'في معلومة ناقصة',
  '5000': 'الرقم مش مدعوم',
  '6000': 'اسم المرسل مش معرّف على الحساب',
  '10000': 'الشركة مش سامحة بالإرسال من خادمنا (IP)',
  '15000': 'الإرسال عبر API مش مفعّل بحساب الشركة',
  no_login: 'لسا ما انحط حساب الرسائل بالإعدادات',
  network: 'ما في اتصال مع شركة الرسائل',
}
export const smsError = (code: string) => SMS_ERRORS[code] ?? (code.startsWith('http_') ? 'شركة الرسائل ما ردّت' : `رمز ${code}`)

/** One SMS holds 70 Arabic letters; a longer one is cut in parts of 67. */
export const smsParts = (text: string) => (text.length <= 70 ? 1 : Math.ceil(text.length / 67))

function server() {
  const sb = getSupabase()
  if (!sb || !navigator.onLine) throw new Error('offline')
  return sb
}

export interface SmsInfo { ready: boolean; user: string | null; sender: string; balance: string | null }

export async function smsInfo(balance = false): Promise<SmsInfo> {
  const { data, error } = await server().rpc('sms_info', { p_balance: balance })
  if (error) throw new Error('failed')
  return data as SmsInfo
}

export async function saveSmsLogin(user: string, pass: string, sender: string) {
  const { error } = await server().rpc('sms_set_login', { p_user: user, p_pass: pass, p_sender: sender })
  if (error) throw new Error('failed')
}

export interface SendResult { sent: number; failed: Array<{ phone: string; code: string }> }

/** Sends one text to many numbers, five per call (each call waits for the provider). */
export async function sendCompanySms(phones: string[], text: string, taskId: string | null = null, onProgress?: (done: number) => void): Promise<SendResult> {
  const sb = server()
  const out: SendResult = { sent: 0, failed: [] }
  for (let i = 0; i < phones.length; i += 5) {
    const { data, error } = await sb.rpc('sms_send', { p_phones: phones.slice(i, i + 5), p_text: text, p_task: taskId })
    if (error) {
      out.failed.push(...phones.slice(i, i + 5).map((phone) => ({ phone, code: navigator.onLine ? 'failed' : 'network' })))
      continue
    }
    const r = data as SendResult
    out.sent += r.sent
    out.failed.push(...r.failed)
    onProgress?.(Math.min(i + 5, phones.length))
  }
  return out
}
