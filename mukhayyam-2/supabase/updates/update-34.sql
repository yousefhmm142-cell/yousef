-- =====================================================================
--  نظام مخيم 2: التحديث 34 · الأحمال حسب الساعة
--  يُطبَّق تلقائياً مع الرفع (أو الصقه في Supabase > SQL Editor ثم Run). تكراره لا يضر.
-- =====================================================================
-- Six bands of the day (7–9, 9–12, 12–3, 3–6, 6–9, 9–12 at night), as on the paper sheets.
--  · Distribution: per zone, three readings in every band  -> zone_day_entries.band_loads  [[a,b,c] x 6]
--  · Generation: per generator, one reading in every band  -> generator_day_logs.band_loads [a x 6]
-- An empty cell is null (a dash on the sheet). The old L1/L2/L3 columns stay for the days already sent.

alter table public.zone_day_entries add column if not exists band_loads jsonb;
alter table public.generator_day_logs add column if not exists band_loads jsonb;

alter table public.zone_day_entries drop constraint if exists zone_day_entries_band_loads_shape;
alter table public.zone_day_entries add constraint zone_day_entries_band_loads_shape
  check (band_loads is null or (jsonb_typeof(band_loads) = 'array' and jsonb_array_length(band_loads) = 6));
alter table public.generator_day_logs drop constraint if exists generator_day_logs_band_loads_shape;
alter table public.generator_day_logs add constraint generator_day_logs_band_loads_shape
  check (band_loads is null or (jsonb_typeof(band_loads) = 'array' and jsonb_array_length(band_loads) = 6));

notify pgrst, 'reload schema';
