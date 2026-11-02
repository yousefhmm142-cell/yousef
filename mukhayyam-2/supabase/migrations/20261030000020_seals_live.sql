-- =====================================================================
--  نظام مخيم 2: الأختام - ما تعمله محاسن يظهر عند علياء فوراً
-- =====================================================================
-- Puts the three seals tables on the project's change feed (Realtime), so every screen with the
-- seals open hears of a change at once. Nothing happens on a project without Realtime.

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['seals', 'seal_batches', 'seal_rolls'] loop
      if not exists (
        select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

notify pgrst, 'reload schema';
