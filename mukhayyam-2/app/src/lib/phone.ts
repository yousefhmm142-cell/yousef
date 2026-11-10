/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits typed on Arabic keyboards become 0-9. */
export function toLatinDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
}

/** Accepts 0599..., 599..., +970599..., 00972599... and spaces or dashes; returns 0599xxxxxx. */
export function normalizePhone(input: string): string {
  let digits = toLatinDigits(input).replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('970') || digits.startsWith('972')) digits = '0' + digits.slice(3)
  if (digits.length === 9 && digits.startsWith('5')) digits = '0' + digits
  return digits.slice(0, 10)
}

export const isValidPhone = (phone: string) => /^05\d{8}$/.test(phone)

/** 0599123456 -> 059 912 3456 */
export function formatPhone(phone: string): string {
  return phone.length === 10 ? `${phone.slice(0, 3)} ${phone.slice(3, 6)} ${phone.slice(6)}` : phone
}
