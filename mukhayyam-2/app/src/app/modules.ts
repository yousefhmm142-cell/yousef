import {
  LayoutGrid,
  ListChecks,
  ScanLine,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react'

export type ModuleKey =
  | 'generation'
  | 'distribution'
  | 'tasks'
  | 'my-tasks'
  | 'attendance-board'
  | 'my-attendance'

export interface ModuleInfo {
  title: string
  summary: string
  icon: LucideIcon
  /** The build step (see README) that delivers this screen. */
  step: number
  features: string[]
}

export const TOTAL_STEPS = 7

export const modules: Record<ModuleKey, ModuleInfo> = {
  generation: {
    title: 'تقارير موقع التوليد',
    summary: 'كل تقرير كما وصل من الموقع، بنفس ترتيب الورقة.',
    icon: Zap,
    step: 3,
    features: ['التنقّل بين الأيام بالأسهم أو التقويم', 'تنبيهات الوقود والحرارة وضغط الزيت', 'اعتماد التقرير أو إعادته للتصحيح', 'طباعة بنفس شكل الورقة'],
  },
  distribution: {
    title: 'التوزيع والأحمال',
    summary: 'المناطق الست والتشغيلات الست في جدول واحد.',
    icon: LayoutGrid,
    step: 4,
    features: ['عدد الساعات لكل منطقة', 'أحمال الفازات الثلاث لكل تشغيلة', 'التنقّل بين الأيام والاعتماد', 'طباعة بنفس شكل الورقة'],
  },
  tasks: {
    title: 'المهام الميدانية',
    summary: 'إسناد المهام للفنيين ومتابعتها لحظة بلحظة.',
    icon: ListChecks,
    step: 5,
    features: ['إسناد مهمة لفني بضغطتين', 'إرسالها SMS أو واتساب برسالة جاهزة', 'عدّاد حي لكل مهمة قيد التنفيذ', 'تنبيه إذا تجاوزت مهمة وقتها'],
  },
  'my-tasks': {
    title: 'مهامي',
    summary: 'المهام التي أرسلها لك المدير.',
    icon: ListChecks,
    step: 5,
    features: ['تصلك المهمة برسالة ورابط مباشر', 'زر «بدء» يشغّل العدّاد', 'زر «إتمام» مع ملاحظاتك وصورة اختيارية', 'يعمل حتى بدون إنترنت'],
  },
  'attendance-board': {
    title: 'الحضور والانصراف',
    summary: 'حالة الفريق اليوم: حاضر، غائب، انصرف.',
    icon: Users,
    step: 6,
    features: ['أوقات الحضور والانصراف بتوقيت الخادم', 'ساعات العمل الفعلية والإضافية', 'طباعة ورقة QR للمكتب', 'تصحيح يدوي مع ذكر السبب'],
  },
  'my-attendance': {
    title: 'الحضور',
    summary: 'سجّل حضورك وانصرافك بمسح ورقة المكتب.',
    icon: ScanLine,
    step: 6,
    features: ['زر واحد كبير يتغيّر من حضور إلى انصراف', 'تأكيد فوري: «أهلاً قصي · حضور 7:58 ص»', 'سجل أيامك وساعاتك', 'يعمل حتى بدون إنترنت'],
  },
}
