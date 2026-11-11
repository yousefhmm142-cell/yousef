-- =====================================================================
--  نظام مخيم 2: التحديث 41 · مورّد وسعر السولار الوارد، وجدول صيانة المولدات
--  يُطبَّق تلقائياً مع الرفع (أو الصقه في Supabase > SQL Editor ثم Run). تكراره لا يضر.
-- =====================================================================
-- Fuel received on a day now carries who supplied it and the price per liter (both optional), next to the
-- shipment number it already had. The reports list every shipment and flag a repeated or missing number.
alter table public.site_report_fuel add column if not exists supplier text;
alter table public.site_report_fuel add column if not exists unit_price numeric check (unit_price is null or (unit_price >= 0 and unit_price < 1000));

-- How often each kind of maintenance is due, by running hours or by days (whichever is set). Oil change
-- keeps its own two settings (oil_change_warn_hours / oil_change_due_hours).
alter table public.app_settings add column if not exists maintenance_plan jsonb not null default
  '{"oil_filter":{"hours":250},"fuel_filter":{"hours":500},"air_filter":{"hours":500},"cooling":{"days":30},"battery":{"days":60},"belt":{"days":90}}'::jsonb;

-- The manager edits the plan (Settings). Only known kinds, whole positive numbers.
create or replace function public.maintenance_plan_set(p_plan jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  k text;
  v jsonb;
begin
  if not public.is_manager() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p_plan) is distinct from 'object' then raise exception 'bad_plan'; end if;
  for k, v in select * from jsonb_each(p_plan) loop
    if k not in ('oil_filter', 'fuel_filter', 'air_filter', 'cooling', 'battery', 'belt', 'electrical') then raise exception 'bad_plan'; end if;
    if exists (select 1 from jsonb_each(v) x where x.key not in ('hours', 'days')
               or jsonb_typeof(x.value) <> 'number' or (x.value)::numeric <= 0 or (x.value)::numeric > 10000
               or (x.value)::numeric <> trunc((x.value)::numeric)) then
      raise exception 'bad_plan';
    end if;
  end loop;
  update public.app_settings set maintenance_plan = p_plan where id;
end $$;
revoke execute on function public.maintenance_plan_set(jsonb) from anon, public;
grant execute on function public.maintenance_plan_set(jsonb) to authenticated;

notify pgrst, 'reload schema';
