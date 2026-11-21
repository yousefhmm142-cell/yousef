import {ArrowDown, ArrowLeft, CheckCheck, ClipboardList, GitMerge, MessageSquareText, Stamp, UserRound, Wrench} from 'lucide-react'
import {useState} from 'react'
import '../../styles/guide-map.css'

const examples = {
 later: {label:'الختم بعد المهمة', title:'مهند كبس «تم»، وبعدها محاسن سجّلت الختم', text:'المهمة #33 منجزة. لما يتسجّل ختمها وتكون المطابقة واضحة، بينضاف الختم لنفس المهمة. العدد بظل 1.', seal:'223516', status:'المهمة #33 · الختم 223516'},
 earlier: {label:'الإنجاز من الختم', title:'محاسن اختارت المهمة وحفظت ختمها', text:'اختيار المهمة المعلقة ثم «حفظ وإنجاز المهمة» بينجز الطلب وبيربط الختم بنفس العملية. المجهّزة بدون فني بتتعيّن لصاحب الختم تلقائيًا عند الحفظ. تسجيل ختم يدوي بدون اختيار مهمة ما بيسكّر أي طلب.', seal:'223516', status:'المهمة #33 · الختم 223516'},
 none: {label:'شغل بدون ختم', title:'شد كابل، وما احتاج الفني أي ختم', text:'مهند بيسجّل الإنجاز وبيترك خانة الأختام فاضية. المهمة منجزة ومحسوبة عادي، ومش ناقصها إشي.', seal:'بدون ختم', status:'المهمة #33 · بدون ختم'},
} as const
type Example = keyof typeof examples

/** A semantic, responsive map; everything here is an illustrative example, not customer data. */
export function WorkMap(){
 const [example,setExample]=useState<Example>('later')
 const chosen=examples[example]
 return <section id="g-work-map" className="work-map card" aria-labelledby="work-map-title">
  <header className="wm-head">
   <span className="wm-eyebrow"><GitMerge size={16}/> خريطة الشغل · من الطلب للكشف</span>
   <h2 id="work-map-title">مهمة وختم… وشغل محسوب مرة وحدة.</h2>
   <p>المهمة هي الطلب. الختم رقم القطعة المستخدمة. بنربطهم لما يكونوا لنفس الشغل، والختم مش شرط للإنجاز.</p>
  </header>
  <div className="wm-examples" role="group" aria-label="جرّب مثال على مسار الشغل">
   {(Object.keys(examples) as Example[]).map(key=><button key={key} type="button" aria-pressed={example===key} onClick={()=>setExample(key)}>{examples[key].label}</button>)}
  </div>
  <div className="wm-canvas">
   <ol className="wm-start">
    <li><span className="wm-icon"><ClipboardList size={23}/></span><small>01 · المكتب</small><h3>جهّز الطلب</h3><p>المشترك، نوع الشغل والمكان.<br/>بياخد مرجع ثابت مثل <bdi>#33</bdi>.</p><ArrowLeft className="wm-next" size={22} aria-hidden="true"/></li>
    <li><span className="wm-icon"><MessageSquareText size={23}/></span><small>02 · الإرسال</small><h3>أعطِه لفني أو أكثر</h3><p>SMS هو الخيار الأول. المشتركة: رسالة لكل فني من رصيد الشركة.</p><ArrowLeft className="wm-next" size={22} aria-hidden="true"/></li>
    <li><span className="wm-icon"><UserRound size={23}/></span><small>03 · الميدان</small><h3>الفني بنفّذ الشغل</h3><p>بيكتب عالدفتر، أو بيسجّل من «مهامي» إذا معه جوال.</p></li>
   </ol>
   <div className="wm-junction"><span>هل استُخدم ختم؟</span><ArrowDown size={22} aria-hidden="true"/></div>
   <div className="wm-lanes">
    <article className="wm-lane" data-current={example==='none'}>
     <header><Wrench size={23}/><div><small>المسار الأول</small><h3>لا، الشغل بدون ختم</h3></div></header>
     <p>من زر «تم»: سجّل شو انعمل واترك الأختام فاضية.</p>
     <div className="wm-outcome"><CheckCheck size={19}/><b>إنجاز كامل، بينحسب عادي</b></div>
     <span className="wm-lane-note">مثل شد كابل أو أي شغل ما احتاج ختم.</span>
    </article>
    <article className="wm-lane" data-current={example!=='none'}>
     <header><Stamp size={23}/><div><small>المسار الثاني</small><h3>نعم، فيه ختم مستخدم</h3></div></header>
     <div className="wm-choices"><p>رقم الختم يُكتب مع «تم الإنجاز»</p><span>أو</span><p>محاسن / علياء بتختار المهمة وبتحفظ ختمها</p></div>
     <div className="wm-match"><GitMerge size={19}/><b>تطابق واضح = ربط تلقائي</b><ul><li>نفس الفني</li><li>نفس المشترك</li><li>نفس نوع العمل</li><li>نفس يوم الإنجاز</li></ul></div>
     <span className="wm-lane-note">القديم والجديد مشمولين. الختم المسجّل من الإنجاز بيظهر عند المحاسبة؛ ما بتعيد تسجيل استخدامه.</span>
    </article>
   </div>
   <div className="wm-merge" aria-hidden="true"><ArrowDown size={24}/></div>
   <div className="wm-result">
    <div><span className="wm-eyebrow">04 · النتيجة</span><h3>سجل واضح، وعدّ بدون تكرار</h3><p>مرجع المهمة بظل ثابت. الأختام بتظهر معها، والكشف بيجمع الشغل حسب نوعه ويوم إنجازه.</p></div>
    <div className="wm-ticket"><span>مثال توضيحي · أحمد / خالد</span><b><bdi>{chosen.status}</bdi></b><span>{example==='none'?'شد كابل':'صيانة كابل'}</span><strong>1 <small>عمل منجز</small></strong></div>
   </div>
  </div>
  <div className="wm-story" aria-live="polite" aria-atomic="true"><b>{chosen.title}</b><p>{chosen.text}</p></div>
  <div className="wm-notes">
   <p><b>مهمتان مطابقتان بنفس اليوم؟</b> ما بنختار بالتخمين؛ المحاسبة بتحدد رقم المهمة. اختلاف اليوم يعني شغل منفصل.</p>
   <p><b>شغل ما إله طلب سابق؟</b> تسجيل المحاسبة بينحسب عملًا مستقلًا. والختم المتعدد لنفس العمل ما بيضاعف إنجازه.</p>
   <p><b>مين بكبس «تم»؟</b> مهند من المكتب، أو الفني لمهمته الفردية من «مهامي». المحاسبة كمان بتنجز المهمة المختارة مع حفظ ختمها. المشتركة إلها إنجاز واحد ومشاركة لكل فني.</p>
   <p><b>النت مقطوع؟</b> الإنجاز والتسجيل بينحفظوا على الجهاز، والربط بيتأكد بعد المزامنة. المشترك أو الشغل الناقص بده استكمال حتى يصير التطابق واضحًا.</p>
  </div>
 </section>
}
