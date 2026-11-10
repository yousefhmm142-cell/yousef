-- =====================================================================
--  نظام مخيم 2: تحديث صلاحيات موظف موقع التوليد
--  لمشروع شُغّل عليه setup.sql من قبل: الصق هذا الملف في SQL Editor ثم Run، مرة واحدة.
-- =====================================================================
-- The people at the generation site fill both daily forms: the generation report and the
-- distribution sheet. Both site roles (generation_operator, distribution_supervisor) now act the
-- same on both; managers are unchanged.

create or replace function public.is_site_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('generation_operator', 'distribution_supervisor')
$$;

-- Same steps as before (draft -> submitted -> approved / returned); "site staff" replaces the one
-- filler role per sheet.
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
    if r = 'manager' and not (old.status = 'submitted' and new.status in ('approved', 'returned')) then
      raise exception 'The manager can only approve or return a sent sheet';
    end if;
    if not site and r is distinct from 'manager' and r is distinct from 'admin' then
      raise exception 'Not allowed';
    end if;
    if new.status = 'submitted' then
      new.submitted_by := me;
      -- No lower bound from created_at: a sheet filled offline reaches the server (and is created
      -- there) only when the phone reconnects, after it was really sent.
      new.submitted_at := public.event_time(new.recorded_offline, new.device_time, null);
      new.returned_reason := null;
    elsif new.status = 'approved' then
      new.approved_by := me;
      new.approved_at := now();
    elsif new.status = 'returned' then
      if length(btrim(coalesce(new.returned_reason, ''))) = 0 then
        raise exception 'Returning a sheet needs a reason';
      end if;
      new.approved_by := null; new.approved_at := null;
    end if;
  else
    -- Server-owned columns cannot be changed by hand.
    new.submitted_by := old.submitted_by; new.submitted_at := old.submitted_at;
    new.approved_by := old.approved_by; new.approved_at := old.approved_at;
  end if;
  new.created_by := old.created_by;
  return new;
end $$;

create or replace function public.site_report_editable(p_report_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager() or (
    public.is_site_staff()
    and exists (select 1 from public.site_reports where id = p_report_id and status in ('draft', 'returned'))
  )
$$;

create or replace function public.distribution_sheet_editable(p_sheet_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager() or (
    public.is_site_staff()
    and exists (select 1 from public.distribution_sheets where id = p_sheet_id and status in ('draft', 'returned'))
  )
$$;

-- Reading and starting either form: managers and the site.
do $$
declare t text;
begin
  foreach t in array array['site_reports', 'distribution_sheets'] loop
    execute format('alter policy %I on public.%I using (public.is_manager() or public.is_site_staff())', t || '_read', t);
    execute format('alter policy %I on public.%I with check (public.is_manager() or public.is_site_staff())', t || '_insert', t);
    execute format('alter policy %I on public.%I using (public.is_manager() or public.is_site_staff()) with check (public.is_manager() or public.is_site_staff())', t || '_update', t);
  end loop;
  foreach t in array array['site_report_fuel', 'generator_day_logs', 'generator_runs', 'maintenance_logs', 'zone_day_entries', 'zone_runs'] loop
    execute format('alter policy %I on public.%I using (public.is_manager() or public.is_site_staff())', t || '_read', t);
  end loop;
end $$;

revoke execute on function public.is_site_staff() from anon, public;
grant execute on function public.is_site_staff() to authenticated;

-- Tell the Data API about the new function right away.
notify pgrst, 'reload schema';
