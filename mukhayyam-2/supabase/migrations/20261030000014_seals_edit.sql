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
