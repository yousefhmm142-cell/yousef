-- =====================================================================
--  نظام مخيم 2: التحديث 15 · حذف موظف وسلة المهملات (لمدير الفرع فقط)
--  الصق هذا الملف كاملاً في Supabase > SQL Editor ثم اضغط Run (تكراره لا يضر).
--  النتيجة المتوقعة: Success. No rows returned
-- =====================================================================

-- =====================================================================
--  نظام مخيم 2: حذف موظف (سلة المهملات) لمدير الفرع فقط
-- =====================================================================
-- The branch manager (role «manager», not the admin) can delete a person: they leave every list and
-- cannot sign in, but nothing they did is lost, and they wait in the trash to be brought back.

alter table public.employees add column if not exists deleted_at timestamptz;

create or replace function public.admin_delete_employee(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_role public.user_role; v_user uuid;
begin
  if public.current_user_role() is distinct from 'manager' then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_id = public.current_employee_id() then raise exception 'self'; end if;
  select role, auth_user_id into v_role, v_user from public.employees where id = p_id and deleted_at is null;
  if not found then raise exception 'missing'; end if;
  if v_role in ('admin', 'manager') then raise exception 'protected'; end if;
  update public.employees set deleted_at = now(), is_active = false where id = p_id;
  if v_user is not null then delete from auth.sessions where user_id = v_user; end if;
end $$;

create or replace function public.admin_restore_employee(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() is distinct from 'manager' then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.employees set deleted_at = null, is_active = true where id = p_id and deleted_at is not null;
  if not found then raise exception 'missing'; end if;
end $$;

revoke execute on function public.admin_delete_employee(uuid), public.admin_restore_employee(uuid) from anon, public;
grant execute on function public.admin_delete_employee(uuid), public.admin_restore_employee(uuid) to authenticated;

notify pgrst, 'reload schema';
