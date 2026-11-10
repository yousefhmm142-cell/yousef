-- =====================================================================
--  نظام مخيم 2: التحديث 26 · أنواع مهام ناقصة (نفس أعمال الأختام)
--  يُطبَّق تلقائياً مع الرفع (أو الصقه في Supabase > SQL Editor ثم Run). تكراره لا يضر.
-- =====================================================================
-- Adds the jobs the seal records use that the task types did not have, after the existing ones.

insert into public.task_types (name, sort_order)
select v.name, (select coalesce(max(sort_order), 0) from public.task_types) + v.ord
  from (values ('إضافة مشترك', 1), ('إعادة شبك', 2), ('فك ساعة فحص', 3), ('تركيب ساعة فحص', 4), ('فصل خط', 5), ('تغذية طبلون', 6)) as v (name, ord)
 where not exists (select 1 from public.task_types t where t.name = v.name);

update public.task_types set is_active = true
 where name in ('إضافة مشترك', 'إعادة شبك', 'فك ساعة فحص', 'تركيب ساعة فحص', 'فصل خط', 'تغذية طبلون');
