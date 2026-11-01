-- =====================================================================
--  نظام مخيم 2: التحديث 14 · الصفحات التي يحددها المدير لكل شخص (للاطلاع)
--  الصق هذا الملف كاملاً في Supabase > SQL Editor ثم اضغط Run (بعد التحديث 13، وتكراره لا يضر).
--  النتيجة المتوقعة: Success. No rows returned
-- =====================================================================

-- =====================================================================
--  نظام مخيم 2: الصفحات التي يحددها المدير لكل شخص (للاطلاع)
-- =====================================================================
-- employees.pages: the pages the manager opened for this person to LOOK at (generation,
-- distribution, tasks, attendance, stock). Changing anything stays with the role's own rules.

alter table public.employees add column if not exists pages text[] not null default '{}';

create or replace function public.has_page(p_page text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager() or exists (
    select 1 from public.employees e
     where e.id = public.current_employee_id() and e.is_active and p_page = any (e.pages)
  )
$$;

create or replace function public.admin_set_pages(p_id uuid, p_pages text[]) returns void
language plpgsql security definer set search_path = public as $$
declare v text[];
begin
  if not public.is_manager() then raise exception 'not_allowed' using errcode = '42501'; end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v
    from unnest(coalesce(p_pages, '{}')) as x
   where x in ('generation', 'distribution', 'tasks', 'attendance', 'stock');
  update public.employees set pages = v where id = p_id;
  if not found then raise exception 'missing'; end if;
end $$;

revoke execute on function public.has_page(text), public.admin_set_pages(uuid, text[]) from anon, public;
grant execute on function public.has_page(text), public.admin_set_pages(uuid, text[]) to authenticated;

-- Reading only: the people who were given the page may read its data, on top of what the role
-- already allows (the existing rule of each policy is kept and one more way in is added).
do $$
declare r record; q text;
begin
  for r in
    select * from (values
      ('site_reports', 'site_reports_read', 'generation'),
      ('site_report_fuel', 'site_report_fuel_read', 'generation'),
      ('generator_day_logs', 'generator_day_logs_read', 'generation'),
      ('generator_runs', 'generator_runs_read', 'generation'),
      ('maintenance_logs', 'maintenance_logs_read', 'generation'),
      ('distribution_sheets', 'distribution_sheets_read', 'distribution'),
      ('zone_day_entries', 'zone_day_entries_read', 'distribution'),
      ('zone_runs', 'zone_runs_read', 'distribution'),
      ('tasks', 'tasks_read', 'tasks'),
      ('task_events', 'task_events_read', 'tasks'),
      ('attendance_punches', 'attendance_punches_read', 'attendance'),
      ('leaves', 'leaves_read', 'attendance')
    ) as t (tbl, pol, page)
  loop
    select qual into q from pg_policies where schemaname = 'public' and tablename = r.tbl and policyname = r.pol;
    if q is null then raise exception 'policy % on % not found', r.pol, r.tbl; end if;
    if position('has_page' in q) = 0 then
      execute format('alter policy %I on public.%I using ((%s) or public.has_page(%L))', r.pol, r.tbl, q, r.page);
    end if;
  end loop;
end $$;

drop policy if exists stock_moves_read on public.stock_moves;
create policy stock_moves_read on public.stock_moves for select to authenticated using (public.has_page('stock'));

notify pgrst, 'reload schema';
