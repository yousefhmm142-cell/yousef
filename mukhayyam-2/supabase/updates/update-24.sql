-- =====================================================================
--  نظام مخيم 2: التحديث 24 · قراءات أحمال إضافية بالتوزيع
--  يُطبَّق تلقائياً مع الرفع (أو الصقه في Supabase > SQL Editor ثم Run). تكراره لا يضر.
-- =====================================================================

alter table public.zone_runs add column if not exists load_extra numeric[] not null default '{}';
alter table public.zone_runs drop constraint if exists zone_runs_load_extra_ok;
alter table public.zone_runs add constraint zone_runs_load_extra_ok
  check (cardinality(load_extra) <= 30 and 0 <= all (load_extra));

notify pgrst, 'reload schema';
