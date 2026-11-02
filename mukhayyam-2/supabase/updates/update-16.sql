-- =====================================================================
--  نظام مخيم 2: التحديث 16 · الأختام: تجهيز دفعة بدون اسم ثم تعيين الاسم لاحقاً
--  الصق هذا الملف كاملاً في Supabase > SQL Editor ثم اضغط Run (بعد التحديث 10، وتكراره لا يضر).
--  النتيجة المتوقعة: Success. No rows returned
-- =====================================================================

do $$
begin
  if to_regclass('public.seals') is null then
    raise exception 'شغّل update-10.sql أولاً (run update-10.sql first)';
  end if;
end $$;

alter table public.seal_batches alter column technician_id drop not null;

create or replace function public.seal_issue(p_technician uuid, p_issued_on date, p_seals integer[], p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_employee_id();
  v_n integer := coalesce(array_length(p_seals, 1), 0);
  v_roll uuid;
  v_rolls integer;
  v_bad integer;
  v_batch uuid;
  v_no integer;
begin
  if not public.has_seals() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if v_n = 0 or v_n > 100 then raise exception 'no_seals'; end if;
  if (select count(distinct x) from unnest(p_seals) x) <> v_n then raise exception 'duplicate_seal'; end if;
  -- The name can wait: a prepared batch has none until the accountant picks one.
  if p_technician is not null and not exists (select 1 from public.employees where id = p_technician and role = 'technician' and is_active) then
    raise exception 'bad_technician';
  end if;
  if p_issued_on is null or p_issued_on > public.seal_today() + 1 then raise exception 'bad_date'; end if;

  perform 1 from public.seals where seal_no = any (p_seals) order by seal_no for update;
  select x into v_bad from unnest(p_seals) x where not exists (select 1 from public.seals s where s.seal_no = x) limit 1;
  if v_bad is not null then raise exception 'unknown_seal:%', v_bad; end if;
  select s.seal_no into v_bad from public.seals s where s.seal_no = any (p_seals) and s.status <> 'in_stock' order by s.seal_no limit 1;
  if v_bad is not null then raise exception 'not_available:%', v_bad; end if;
  select count(distinct roll_id), min(roll_id::text)::uuid into v_rolls, v_roll from public.seals where seal_no = any (p_seals);
  if v_rolls > 1 then raise exception 'mixed_rolls'; end if;

  select coalesce(max(batch_no), 0) + 1 into v_no from public.seal_batches where roll_id = v_roll;
  insert into public.seal_batches (roll_id, batch_no, technician_id, issued_on, note, created_by)
    values (v_roll, v_no, p_technician, p_issued_on, nullif(btrim(coalesce(p_note, '')), ''), v_me)
    returning id into v_batch;
  update public.seals s
     set status = 'issued', batch_id = v_batch, batch_pos = o.pos, technician_id = p_technician,
         issued_on = p_issued_on, used_on = null, details = null, board_no = null, updated_by = v_me
    from unnest(p_seals) with ordinality as o (no, pos)
   where s.seal_no = o.no;
  return jsonb_build_object('batch_id', v_batch, 'batch_no', v_no, 'roll_id', v_roll, 'count', v_n);
end $$;


-- Gives a prepared batch its name (a named batch is changed with seal_update_batch).
create or replace function public.seal_assign_batch(p_batch uuid, p_technician uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_employee_id();
begin
  if not public.has_seals() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.employees where id = p_technician and role = 'technician' and is_active) then raise exception 'bad_technician'; end if;
  update public.seal_batches set technician_id = p_technician where id = p_batch;
  if not found then raise exception 'missing'; end if;
  update public.seals set technician_id = p_technician, updated_by = v_me where batch_id = p_batch;
end $$;

revoke execute on function public.seal_issue(uuid, date, integer[], text), public.seal_assign_batch(uuid, uuid) from anon, public;
grant execute on function public.seal_issue(uuid, date, integer[], text), public.seal_assign_batch(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
