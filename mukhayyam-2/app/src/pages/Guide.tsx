import { BookOpen, ClipboardList, FileBarChart, Gauge, LayoutGrid, ListChecks, LogIn, MessageSquareText, ScanLine, Settings, Stamp, UserRound, Wifi, Zap, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { useEmployee } from '../auth/AuthProvider'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { Segmented } from '../ui/form'
import { hasPage, type Employee } from '../types'

// The guide for a new employee: short steps for each job, his own first. Written the way the office talks.

interface Topic {
  key: string
  title: string
  icon: LucideIcon
  /** Whose job this is. */
  mine(e: Employee): boolean
  steps: string[]
  tip?: string
  to?: string
}

const isManager = (e: Employee) => e.role === 'admin' || e.role === 'manager'
const site = (e: Employee) => e.role === 'generation_operator' || hasPage(e, 'generation')
const dist = (e: Employee) => e.role === 'distribution_supervisor' || hasPage(e, 'distribution')

const TOPICS: Topic[] = [
  {
    key: 'start', title: 'أول مرة: الدخول والشغل بدون نت', icon: LogIn, mine: () => true,
    steps: [
      'ادخل برقم جوالك والرمز (6 أرقام) اللي أعطاك إياه المدير. أول ما تكتب الرقم السادس بتدخل لحالك.',
      'ثبّت الموقع على الشاشة الرئيسية: من قائمة المتصفح «إضافة إلى الشاشة الرئيسية». بيصير زي التطبيق.',
      'بعد أول دخول، الموقع بيشتغل حتى لو النت مقطوع: اللي بتكتبه بينحفظ على جوالك وبينبعت لحاله أول ما يرجع النت.',
      'لما يطلع شريط «في تحديث جديد»، اضغط عليه وقت ما تكون مخلّص. الموقع ما بيحدّث حاله وانت شغال.',
    ],
    tip: 'إذا نسيت الرمز، المدير بيغيّره من الإعدادات › الفريق.',
  },
  {
    key: 'offline', title: 'شو يعني «جاري المزامنة»؟', icon: Wifi, mine: () => true,
    steps: [
      'يعني في إشي انكتب على جوالك ولسا ما وصل للخادم. لا تمسح الموقع ولا بيانات المتصفح.',
      'افتح الموقع وانت على نت وبيخلص لحاله خلال ثواني.',
      'إذا ضل عالق، اطلع من الصفحة وارجع، أو بلّغ المدير.',
    ],
  },
  {
    key: 'generation', title: 'تقرير التوليد اليومي', icon: Zap, mine: site, to: '/generation',
    steps: [
      'افتح «التوليد» واضغط «تقرير اليوم». التقرير بخطوات: المحروقات، التشغيل والأحمال، الصيانة، الملاحظات.',
      'المحروقات: الرصيد الموجود بيجي لحاله من متبقي أمس. اكتب الوارد (إذا إجا سولار) ورقم الإرسالية والمورّد، وبعدين المتبقي بالخزان. الاستهلاك بينحسب لحاله.',
      'التشغيل: اختار المولدات اللي اشتغلت، وقت البداية والنهاية، والأحمال بجدول الساعات (Enter بينقلك للمربع اللي بعده).',
      'الصيانة: سجّل أي صيانة (زيت، فلاتر، بطارية…) عشان جدول الصيانة يحسب موعد اللي بعدها.',
      'آخر خطوة «الإرسال» ← «إغلاق وإرسال». بعد الإرسال ما بتقدر تعدّل إلا إذا المدير رجّعه.',
    ],
    tip: 'التقرير بينحفظ وانت بتكتب. بتقدر تسكّر وترجع تكمّل.',
  },
  {
    key: 'distribution', title: 'كشف التوزيع', icon: LayoutGrid, mine: dist, to: '/distribution',
    steps: [
      'افتح «التوزيع» ← «كشف اليوم». لكل منطقة: انغذّت ولا لا، ساعات التغذية، والتشغيلات.',
      'الأحمال: 3 قراءات لكل ساعة (9، 12، 3، 6، 9، 12). المتوسط بينحسب لحاله.',
      'بالآخر «إغلاق وإرسال».',
    ],
  },
  {
    key: 'tasks', title: 'المهام (المكتب)', icon: ListChecks, mine: (e) => hasPage(e, 'tasks'), to: '/tasks',
    steps: [
      'لما يتصل مشترك: «تجهيز مهمة» واكتب اسمه (بيطلعلك من دليل المشتركين) وطلبه.',
      'من «مهام مجهّزة بانتظار فني» اختار المهمة وأعطيها لفني أو أكتر، والأولوية والمدة المتوقعة، وابعتها SMS أو واتساب.',
      'تابع من البطاقات فوق: عند الفنيين، تجاوزت وقتها، خلصت اليوم. وبتقدر ترجع لأيام قبل بالأسهم.',
      '«ملف مشترك» بيوريك كل اللي صار لمشترك: مهامه وأختامه وقراءاته.',
    ],
  },
  {
    key: 'my-tasks', title: 'مهامي (الفني)', icon: ClipboardList, mine: (e) => e.role === 'technician', to: '/',
    steps: [
      'المهام اللي انبعتتلك بتطلع بأول صفحة. افتح المهمة لتشوف التفاصيل والمكان ورقم المشترك.',
      'لما تبلّش اضغط «ابدأ الشغل»، ولما تخلص «خلصت المهمة» واكتب ملاحظة إذا في.',
      'الرابط اللي بيوصلك بالرسالة بيفتح نفس المهمة.',
    ],
  },
  {
    key: 'attendance', title: 'الحضور بالـQR', icon: ScanLine, mine: (e) => e.role !== 'admin', to: '/my-attendance',
    steps: [
      'امسح رمز الـQR الملزوق بالمكتب بكاميرا جوالك أول ما توصل، وكمان لما تروّح.',
      'المسح بيشتغل بس وانت على إنترنت المكتب (الواي فاي).',
      'الانصراف ما بينسجّل قبل ساعة من الحضور. ومسحتين باليوم بس.',
      'من «حضوري» بتشوف أيامك وساعاتك.',
    ],
  },
  {
    key: 'readings', title: 'قراءات العدادات', icon: Gauge, mine: (e) => hasPage(e, 'readings') || hasPage(e, 'readings-admin'), to: '/readings',
    steps: [
      'القارئ: افتح «القراءات»، اختار الطبلون، واكتب قراءة كل مشترك بلوحة الأرقام واضغط «التالي».',
      'كل قراءة بتنحفظ على الجوال فوراً حتى بدون نت، وبتنبعت لحالها.',
      'القراءة ما بتقبل أقل من السابقة. إذا الساعة مفصولة أو مش موجودة اختار الحالة بدل الرقم.',
      'مسؤول القراءات: «رفع ملفات الأسبوع»، وبعدين وزّع المناطق على الفنيين أو الورق، وبالآخر صدّر الملفات معبّاية.',
    ],
  },
  {
    key: 'seals', title: 'الأختام', icon: Stamp, mine: (e) => !!e.canSeals || isManager(e), to: '/seals',
    steps: [
      '«صرف الأختام»: اختار الرول والفني وعدد الأختام واطبع ورقة الصرف.',
      '«تسجيل الأختام والبحث»: سجّل كل ختم انستخدم (التاريخ والتفاصيل ورقم الطبلون)، أو تالف أو ضائع.',
      '«غير المسجّلة»: الأختام اللي عند الفنيين وما انسجّلت، الأقدم أول. اطبعها وتابع معهم.',
    ],
  },
  {
    key: 'manager', title: 'المدير: الاعتماد والتقارير', icon: FileBarChart, mine: isManager, to: '/reports',
    steps: [
      'الرئيسية بتوريك اللي بستناك: تقارير بدها اعتماد، مهام متأخرة، تنبيهات السولار والصيانة.',
      'افتح التقرير واعتمده، أو رجّعه مع سبب ليعدّلوه.',
      '«التقارير»: أسبوعي أو شهري، مع مقارنة بالفترة اللي قبلها ورسوم، وشحنات السولار ومورّديها. Excel أو طباعة.',
    ],
  },
  {
    key: 'settings', title: 'الإعدادات والرسائل', icon: Settings, mine: isManager, to: '/settings',
    steps: [
      'الفريق: إضافة موظف، دوره، رمز دخوله، والصفحات المفتوحة له (الصلاحيات).',
      'الرسائل: رصيد SMS، رسالة جماعية، و«تنبيهات تلقائية» بتوصلك على الجوال لما يتأخر تقرير أو مهمة أو يقرب السولار يخلص، حتى لو ما حدا فاتح الموقع.',
      'جدول صيانة المولدات: كل كم ساعة أو يوم لكل صيانة.',
      'النسخة الاحتياطية: النظام بياخد نسخة كل ليلة. نزّل نسخة على جهازك مرة بالأسبوع.',
    ],
  },
  {
    key: 'sms', title: 'لو صار في مشكلة', icon: MessageSquareText, mine: () => true,
    steps: [
      'شاشة «حدث خطأ غير متوقع»: اضغط «إعادة التحميل». بياناتك المحفوظة ما بتضيع.',
      'إذا تكرر، بلّغ المدير برقم «مرجع العطل» اللي تحت.',
      'لا تمسح بيانات المتصفح إذا في «جاري المزامنة».',
    ],
  },
]

export function Guide() {
  useDocumentTitle('دليل الاستخدام')
  const employee = useEmployee()
  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const shown = scope === 'mine' ? TOPICS.filter((t) => t.mine(employee)) : TOPICS
  return (
    <div className="guide">
      <header className="ph">
        <div>
          <h1><BookOpen size={26} /> دليل الاستخدام</h1>
          <p className="muted">خطوات قصيرة لكل شغلة. أهلاً فيك يا {employee.fullName.split(' ')[0]} 👋</p>
        </div>
        <Segmented<'mine' | 'all'> label="شو بدك تشوف" value={scope} options={[{ value: 'mine', label: 'شغلي أنا' }, { value: 'all', label: 'كل الأقسام' }]} onChange={setScope} />
      </header>
      <nav className="guide-toc card" aria-label="المحتويات">
        {shown.map((t) => <a key={t.key} href={`#g-${t.key}`}><t.icon size={15} />{t.title}</a>)}
      </nav>
      {shown.map((t) => (
        <section key={t.key} id={`g-${t.key}`} className="card guide-topic">
          <div className="card-h"><span className="ico-round brand"><t.icon size={16} /></span><h2>{t.title}</h2>{t.to && <Link to={t.to} className="link-btn card-h-action">افتح الصفحة</Link>}</div>
          <ol>{t.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          {t.tip && <p className="guide-tip">💡 {t.tip}</p>}
        </section>
      ))}
      <p className="muted guide-foot"><UserRound size={14} /> سؤالك مش هون؟ اسأل المدير.</p>
    </div>
  )
}
