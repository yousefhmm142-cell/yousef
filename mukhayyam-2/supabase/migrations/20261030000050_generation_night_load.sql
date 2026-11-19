-- Accept the legacy six generation bands and the new optional 00:00–03:00 reading.
-- No existing rows or distribution bands are rewritten.
alter table public.generator_day_logs drop constraint if exists generator_day_logs_band_loads_shape;
alter table public.generator_day_logs add constraint generator_day_logs_band_loads_shape
 check (band_loads is null or case when jsonb_typeof(band_loads)='array' then jsonb_array_length(band_loads) in (6,7) else false end);

-- Tabs running an older client can only send six bands (or null). Preserve the
-- seventh reading they cannot see. New clients send seven explicit values, so
-- clearing the seventh field is unambiguous and still supported.
create or replace function m2_ops.keep_generation_night_load() returns trigger
language plpgsql set search_path=public as $$
begin
 if jsonb_typeof(old.band_loads)='array' and jsonb_array_length(old.band_loads)=7 then
  if new.band_loads is null then
   new.band_loads := '[null,null,null,null,null,null]'::jsonb || jsonb_build_array(old.band_loads->6);
  elsif jsonb_typeof(new.band_loads)='array' and jsonb_array_length(new.band_loads)=6 then
   new.band_loads := new.band_loads || jsonb_build_array(old.band_loads->6);
  end if;
 end if;
 return new;
end $$;
revoke all on function m2_ops.keep_generation_night_load() from public,anon,authenticated;
drop trigger if exists generator_keep_night_load on public.generator_day_logs;
create trigger generator_keep_night_load before update of band_loads on public.generator_day_logs
 for each row execute function m2_ops.keep_generation_night_load();
notify pgrst,'reload schema';
