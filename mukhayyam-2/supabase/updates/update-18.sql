-- =====================================================================
--  نظام مخيم 2: التحديث 18 · الأختام: إضافة أختام جديدة لدفعة من «تعديل»
--  الصق هذا الملف كاملاً في Supabase > SQL Editor ثم اضغط Run (بعد التحديث 10، وتكراره لا يضر).
--  النتيجة المتوقعة: Success. No rows returned
-- =====================================================================

create or replace function public.seal_add_to_batch(p_batch uuid, p_seals integer[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_employee_id();
  v_n integer := coalesce(array_length(p_seals, 1), 0);
  v_b public.seal_batches;
  v_bad integer;
  v_pos integer;
begin
  if not public.has_seals() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if v_n = 0 or v_n > 100 then raise exception 'no_seals'; end if;
  if (select count(distinct x) from unnest(p_seals) x) <> v_n then raise exception 'duplicate_seal'; end if;
  select * into v_b from public.seal_batches where id = p_batch for update;
  if not found then raise exception 'missing'; end if;

  perform 1 from public.seals where seal_no = any (p_seals) order by seal_no for update;
  select x into v_bad from unnest(p_seals) x where not exists (select 1 from public.seals s where s.seal_no = x) limit 1;
  if v_bad is not null then raise exception 'unknown_seal:%', v_bad; end if;
  select s.seal_no into v_bad from public.seals s where s.seal_no = any (p_seals) and s.status <> 'in_stock' order by s.seal_no limit 1;
  if v_bad is not null then raise exception 'not_available:%', v_bad; end if;
  if exists (select 1 from public.seals where seal_no = any (p_seals) and roll_id <> v_b.roll_id) then raise exception 'mixed_rolls'; end if;

  select coalesce(max(batch_pos), 0) into v_pos from public.seals where batch_id = p_batch;
  update public.seals s
     set status = 'issued', batch_id = p_batch, batch_pos = v_pos + o.pos, technician_id = v_b.technician_id,
         issued_on = v_b.issued_on, used_on = null, details = null, board_no = null, updated_by = v_me
    from unnest(p_seals) with ordinality as o (no, pos)
   where s.seal_no = o.no;
  update public.seal_batches set original_seals = null where id = p_batch;
  return v_n;
end $$;

revoke execute on function public.seal_add_to_batch(uuid, integer[]) from anon, public;
grant execute on function public.seal_add_to_batch(uuid, integer[]) to authenticated;

notify pgrst, 'reload schema';
