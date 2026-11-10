-- =====================================================================
--  نظام مخيم 2: ملف شامل يعوّض أي تحديث ناقص (8 و9 و11)
--  الصق هذا الملف كاملاً في Supabase > SQL Editor ثم اضغط Run. تكراره لا يضر.
--  بشرط أن تكون شغّلت update-10.sql (الأختام) من قبل.
--  النتيجة المتوقعة: Success. No rows returned
-- =====================================================================

do $$
begin
  if to_regclass('public.seals') is null then
    raise exception 'شغّل update-10.sql أولاً (run update-10.sql first)';
  end if;
end $$;


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

-- ===================== 20261030000012_manager_fills.sql =====================

-- =====================================================================
--  نظام مخيم 2: المدير يعبّي كشف التوليد وكشف التوزيع بنفسه
-- =====================================================================
-- Managers (like the system admin) may fill a day's report or sheet and close it, on top of
-- approving and reopening. Site staff are unchanged.

create or replace function public.sheet_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.user_role := public.current_user_role();
  me uuid := public.current_employee_id();
  site boolean := r in ('generation_operator', 'distribution_supervisor');
begin
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'submitted') then
      raise exception 'A new sheet starts as draft or submitted';
    end if;
    new.created_by := coalesce(me, new.created_by);
    new.submitted_by := null; new.submitted_at := null;
    new.approved_by := null; new.approved_at := null;
    if new.status = 'submitted' then
      new.submitted_by := me;
      new.submitted_at := public.event_time(new.recorded_offline, new.device_time, null);
    end if;
    return new;
  end if;

  if site and old.status in ('submitted', 'approved') then
    raise exception 'This sheet was sent and can no longer be edited by site staff';
  end if;

  if new.status is distinct from old.status then
    if site and not (old.status in ('draft', 'returned') and new.status = 'submitted') then
      raise exception 'Site staff can only send a draft or returned sheet';
    end if;
    if r = 'manager' and not (
         (old.status = 'submitted' and new.status in ('approved', 'returned'))
      or (old.status = 'approved' and new.status = 'returned')
      or (old.status in ('draft', 'returned') and new.status = 'submitted')) then
      raise exception 'The manager can fill and close a day, approve a closed day or reopen it';
    end if;
    if not site and r is distinct from 'manager' and r is distinct from 'admin' then
      raise exception 'Not allowed';
    end if;
    if new.status = 'submitted' then
      new.submitted_by := me;
      new.submitted_at := public.event_time(new.recorded_offline, new.device_time, null);
      new.returned_reason := null;
    elsif new.status = 'approved' then
      new.approved_by := me;
      new.approved_at := now();
    elsif new.status = 'returned' then
      if length(btrim(coalesce(new.returned_reason, ''))) = 0 then
        raise exception 'Reopening a day needs a reason';
      end if;
      new.approved_by := null; new.approved_at := null;
    end if;
  else
    new.submitted_by := old.submitted_by; new.submitted_at := old.submitted_at;
    new.approved_by := old.approved_by; new.approved_at := old.approved_at;
  end if;
  new.created_by := old.created_by;
  return new;
end $$;

notify pgrst, 'reload schema';

-- ===================== 20261030000014_seals_edit.sql =====================

-- =====================================================================
--  نظام مخيم 2: الأختام · تعديل الدفعة وحذفها وإرجاع الختم للمخزن
-- =====================================================================
-- Needs update 10 (seals). Everything here can be run again.

-- A batch handed to the wrong technician or on the wrong day.
create or replace function public.seal_update_batch(p_batch uuid, p_technician uuid, p_issued_on date) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_employee_id();
begin
  if not public.has_seals() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.employees where id = p_technician and role = 'technician') then raise exception 'bad_technician'; end if;
  if p_issued_on is null or p_issued_on > public.seal_today() + 1 then raise exception 'bad_date'; end if;
  update public.seal_batches set technician_id = p_technician, issued_on = p_issued_on where id = p_batch;
  if not found then raise exception 'missing'; end if;
  update public.seals set technician_id = p_technician, issued_on = p_issued_on, updated_by = v_me where batch_id = p_batch;
end $$;

-- Takes seals back to the stock, wherever they got to (even used ones: the record is cleared).
create or replace function public.seal_return_to_stock(p_seals integer[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_employee_id();
  v_done integer;
begin
  if not public.has_seals() then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.seals
     set status = 'in_stock', batch_id = null, batch_pos = null, technician_id = null, issued_on = null,
         used_on = null, details = null, board_no = null, updated_by = v_me
   where seal_no = any (p_seals) and status <> 'in_stock';
  get diagnostics v_done = row_count;
  delete from public.seal_batches b where not exists (select 1 from public.seals s where s.batch_id = b.id);
  return v_done;
end $$;

-- Deletes a whole batch: its seals go back to the stock.
create or replace function public.seal_delete_batch(p_batch uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare v_seals integer[];
begin
  if not public.has_seals() then raise exception 'not_allowed' using errcode = '42501'; end if;
  select array_agg(seal_no) into v_seals from public.seals where batch_id = p_batch;
  if v_seals is null then
    delete from public.seal_batches where id = p_batch;
    return 0;
  end if;
  return public.seal_return_to_stock(v_seals);
end $$;

-- The roll's receiving day and note (its numbers stay as registered).
create or replace function public.seal_update_roll(p_roll uuid, p_received date, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_seals() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_received is null or p_received > public.seal_today() + 1 then raise exception 'bad_date'; end if;
  update public.seal_rolls set received_on = p_received, note = nullif(btrim(coalesce(p_note, '')), '') where id = p_roll;
  if not found then raise exception 'missing'; end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['seal_update_batch(uuid, uuid, date)', 'seal_return_to_stock(integer[])', 'seal_delete_batch(uuid)', 'seal_update_roll(uuid, date, text)'] loop
    execute format('revoke execute on function public.%s from anon, public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
