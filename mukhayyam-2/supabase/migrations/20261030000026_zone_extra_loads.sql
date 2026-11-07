-- =====================================================================
--  نظام مخيم 2: قراءات أحمال إضافية بالتوزيع (أكثر من L1 L2 L3)
-- =====================================================================
-- The site may read as many loads as it needs for a run; they count in the run's average.

alter table public.zone_runs add column if not exists load_extra numeric[] not null default '{}';
alter table public.zone_runs drop constraint if exists zone_runs_load_extra_ok;
alter table public.zone_runs add constraint zone_runs_load_extra_ok
  check (cardinality(load_extra) <= 30 and 0 <= all (load_extra));

notify pgrst, 'reload schema';
