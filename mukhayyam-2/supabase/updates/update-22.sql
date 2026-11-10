-- =====================================================================
--  نظام مخيم 2: التحديث 22 · إضافة موظفي البطالة إلى كشف الحضور
--  يُطبَّق تلقائياً مع الرفع (أو الصقه في Supabase > SQL Editor ثم Run). تكراره لا يضر.
-- =====================================================================
-- Adds the people on «بطالة» hours (from the paper list) so they show on their own weekly sheet.
-- Someone already in the system under the same name is not added again: only moved to «بطالة» hours.

do $$
declare
  v_idle smallint := (select id from public.work_schedules where name = 'بطالة');
  v_name text;
begin
  if v_idle is null then raise notice 'no «بطالة» schedule: nothing done'; return; end if;
  foreach v_name in array array['يوسف مروان حمدان', 'محمد وديع حمدان', 'مصطفى سامح فرحات', 'عامر كامل عبدالله عيد', 'محمد رامي أبو عجوة'] loop
    if exists (select 1 from public.employees where regexp_replace(full_name, '\s+', ' ', 'g') = v_name) then
      update public.employees set schedule_id = v_idle, tracks_attendance = true
       where regexp_replace(full_name, '\s+', ' ', 'g') = v_name;
    else
      insert into public.employees (full_name, role, schedule_id, tracks_attendance, is_active)
      values (v_name, 'staff', v_idle, true, true);
    end if;
  end loop;
end $$;
