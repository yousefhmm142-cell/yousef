-- =====================================================================
--  نظام مخيم 2: التحديث 8 · إغلاق إضافي ضد أي وصول بدون تسجيل دخول
--  الصق هذا الملف كاملاً في Supabase > SQL Editor ثم اضغط Run (تكراره لا يضر).
--  النتيجة المتوقعة: Success. No rows returned
-- =====================================================================

-- ===================== 20261030000011_lock_down.sql =====================

-- =====================================================================
--  نظام مخيم 2: إغلاق إضافي (حماية فوق الحماية)
-- =====================================================================
-- Row rules (RLS) already stop a visitor who is not signed in from reading anything. This takes
-- away the table rights themselves too, so nothing depends on one layer only:
-- 1. A visitor who is not signed in (anon) has no right on any table, now or in tables added later.
-- 2. They may run only the few functions the public pages need: the attendance QR page, the
--    technician's task link, and the first-time setup screen (which refuses once an admin exists).

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname not in ('attendance_people', 'attendance_register', 'attendance_punch',
                             'task_link_view', 'task_link_act', 'setup_needed', 'setup_first_admin')
  loop
    -- Whoever signed in keeps exactly what they had; only the not-signed-in visitor loses it.
    if has_function_privilege('authenticated', f.sig, 'execute') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    execute format('revoke execute on function %s from anon, public', f.sig);
  end loop;
end $$;

-- Signed-in people keep their rights; RLS and the guards decide what each of them may do.
notify pgrst, 'reload schema';
