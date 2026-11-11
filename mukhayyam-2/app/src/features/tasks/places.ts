import { fold } from './subscribers'

/** The places the office uses when a subscriber says where he is (sorted, for quick finding). */
export const PLACES = [
  'الشوافعة', 'الفقي', 'حارة الشافعي', 'القدس', 'الأهرام', 'أبو ذر', 'هويشل', 'مكتب', 'أبو رحمة', 'الطلاع', 'أبو عمرة', 'صبح', 'مدارس', 'شقاقي',
  'زهرة الربيع', 'مكتبة', 'الحاج', 'الأبراج', 'نونة', 'فنونة', 'أبو عمار', 'الحملاوي', 'نادي الأهلي', 'الدهلي', 'العلي', 'الحلو', 'عشرين', 'التحلي',
  'دباغ', 'الحسنات', 'النور', 'شمال', 'برج', 'أبو بطيحان', 'أبو عبيدة', 'شرقية', 'حميدة', 'أبو أنور', 'خوالدة', 'المقبرة', 'مدخل', 'محل', 'عاشور',
  'السنة', 'النهرام',
].sort((a, b) => a.localeCompare(b, 'ar'))

/** The subscriber's area as a place: the list's own spelling when it is one of them, else the area as written. */
export function placeFor(area: string): string {
  const a = fold(area)
  if (!a) return ''
  return PLACES.find((p) => fold(p) === a) ?? PLACES.find((p) => a.includes(fold(p)) || fold(p).includes(a)) ?? area.trim()
}
