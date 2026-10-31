-- =====================================================================
--  نظام مخيم 2: موظف الموقع يضيف المولدات ويعدّلها بنفسه + تحديث فوري للمدير
-- =====================================================================
-- 1. The site employee adds a generator, or changes its settings (name, brand, kVA, litres per
--    hour), straight from the day's report. Managers can do the same from the settings.
-- 2. The two daily sheets are announced on Realtime, so the manager's screen updates the moment
--    the site types something (when Realtime is available on the project).

create or replace function public.save_generator(
  p_id smallint,
  p_name text,
  p_brand text,
  p_model text,
  p_capacity_kva numeric,
  p_liters_per_hour numeric,
  p_is_active boolean
) returns smallint
language plpgsql security definer set search_path = public as $$
declare
  v_id smallint;
  v_name text := btrim(coalesce(p_name, ''));
  v_brand text := btrim(coalesce(p_brand, ''));
begin
  if not (public.is_manager() or public.is_site_staff()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if length(v_name) not between 1 and 60 then raise exception 'bad_name'; end if;
  if length(v_brand) > 60 then raise exception 'bad_name'; end if;

  if p_id is null then
    insert into public.generators (name, brand, model, capacity_kva, liters_per_hour, is_active, sort_order)
    values (v_name, v_brand, nullif(btrim(coalesce(p_model, '')), ''), p_capacity_kva, p_liters_per_hour, coalesce(p_is_active, true),
            coalesce((select max(sort_order) from public.generators), 0) + 1)
    returning id into v_id;
  else
    update public.generators set
      name = v_name, brand = v_brand, model = nullif(btrim(coalesce(p_model, '')), ''),
      capacity_kva = p_capacity_kva, liters_per_hour = p_liters_per_hour, is_active = coalesce(p_is_active, true)
    where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'missing'; end if;
  end if;
  return v_id;
end $$;

revoke execute on function public.save_generator(smallint, text, text, text, numeric, numeric, boolean) from anon, public;
grant execute on function public.save_generator(smallint, text, text, text, numeric, numeric, boolean) to authenticated;

-- Realtime for the daily sheets (skipped quietly where Realtime is not installed).
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['site_reports', 'distribution_sheets'] loop
      if not exists (
        select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

notify pgrst, 'reload schema';
