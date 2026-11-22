-- Generator readings belong to distribution; closing generation must not block their entry.
create or replace function public.generator_load_day_editable(p_date date) returns boolean
language sql stable security definer set search_path=public as $$
 select (public.is_manager() or public.can_fill_distribution())
 and p_date<=(public.server_now() at time zone 'Asia/Gaza')::date
 and (public.is_manager() or not exists(
  select 1 from distribution_sheets where sheet_date=p_date and status in ('submitted','approved')
 ))
$$;
revoke all on function public.generator_load_day_editable(date) from public,anon;
grant execute on function public.generator_load_day_editable(date) to authenticated;

create or replace function public.sheet_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.user_role := public.current_user_role();
  me uuid := public.current_employee_id();
  site boolean := r not in ('admin', 'manager') and case tg_table_name
    when 'site_reports' then public.can_fill_generation()
    else public.can_fill_distribution() end;
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

  -- A nested child trigger may refresh the report cursor, without editing any report field.
  if tg_op='UPDATE' and tg_table_name='site_reports' and pg_trigger_depth()>1
     and (to_jsonb(new)-'updated_at') is not distinct from (to_jsonb(old)-'updated_at') then
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
notify pgrst,'reload schema';
