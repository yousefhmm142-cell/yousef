-- =====================================================================
--  نظام مخيم 2: التحديث 35 · اللي انفتحت له صفحة التوليد أو التوزيع يعبّي ويرسل
--  يُطبَّق تلقائياً مع الرفع (أو الصقه في Supabase > SQL Editor ثم Run). تكراره لا يضر.
-- =====================================================================
-- Until now a page opened for someone (Settings › Permissions) was for looking only. Now whoever is given
-- «التوليد» fills and sends the generation report, and whoever is given «التوزيع» fills and sends the
-- distribution sheet, exactly as the site staff do (draft or reopened day only; the manager approves).

-- Only what was given to the person: managers do not count here (they have their own rules).
create or replace function public.has_own_page(p_page text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.employees e
     where e.id = public.current_employee_id() and e.is_active and p_page = any (e.pages)
  )
$$;

create or replace function public.can_fill_generation() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('generation_operator', 'distribution_supervisor') or public.has_own_page('generation')
$$;

create or replace function public.can_fill_distribution() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('generation_operator', 'distribution_supervisor') or public.has_own_page('distribution')
$$;

-- «Site staff» (who may also add a generator from the report) now includes them.
create or replace function public.is_site_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_fill_generation() or public.can_fill_distribution()
$$;

create or replace function public.site_report_editable(p_report_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager() or (
    public.can_fill_generation()
    and exists (select 1 from public.site_reports where id = p_report_id and status in ('draft', 'returned'))
  )
$$;

create or replace function public.distribution_sheet_editable(p_sheet_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager() or (
    public.can_fill_distribution()
    and exists (select 1 from public.distribution_sheets where id = p_sheet_id and status in ('draft', 'returned'))
  )
$$;

-- Same steps as before; «site» is whoever fills this kind of sheet (by role or by the page given).
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

-- Reading, starting and updating each form.
do $$
declare t text;
begin
  execute 'alter policy site_reports_read on public.site_reports using (public.can_fill_generation() or public.has_page(''generation''))';
  execute 'alter policy site_reports_insert on public.site_reports with check (public.is_manager() or public.can_fill_generation())';
  execute 'alter policy site_reports_update on public.site_reports using (public.is_manager() or public.can_fill_generation()) with check (public.is_manager() or public.can_fill_generation())';
  execute 'alter policy distribution_sheets_read on public.distribution_sheets using (public.can_fill_distribution() or public.has_page(''distribution''))';
  execute 'alter policy distribution_sheets_insert on public.distribution_sheets with check (public.is_manager() or public.can_fill_distribution())';
  execute 'alter policy distribution_sheets_update on public.distribution_sheets using (public.is_manager() or public.can_fill_distribution()) with check (public.is_manager() or public.can_fill_distribution())';
  foreach t in array array['site_report_fuel', 'generator_day_logs', 'generator_runs', 'maintenance_logs'] loop
    execute format('alter policy %I on public.%I using (public.can_fill_generation() or public.has_page(''generation''))', t || '_read', t);
  end loop;
  foreach t in array array['zone_day_entries', 'zone_runs'] loop
    execute format('alter policy %I on public.%I using (public.can_fill_distribution() or public.has_page(''distribution''))', t || '_read', t);
  end loop;
end $$;

revoke execute on function public.has_own_page(text), public.can_fill_generation(), public.can_fill_distribution(), public.is_site_staff() from anon, public;
grant execute on function public.has_own_page(text), public.can_fill_generation(), public.can_fill_distribution(), public.is_site_staff() to authenticated;

notify pgrst, 'reload schema';
