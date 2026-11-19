-- Update 50: generator readings entered from distribution, linked to generation reports.
-- Daily generator readings are entered with distribution, independently of when
-- the generation report is created. The report embeds the same canonical rows.
create table if not exists public.generator_load_entries (
 id uuid primary key default gen_random_uuid(),
 load_date date not null,
 generator_id smallint not null references public.generators(id),
 report_id uuid references public.site_reports(id) on delete set null,
 load_unit public.load_unit not null default 'A',
 band_loads jsonb not null,
 updated_by uuid references public.employees(id) on delete set null,
 updated_at timestamptz not null default now(),
 unique(load_date,generator_id)
);
create or replace function m2_ops.valid_generator_loads(v jsonb) returns boolean
language plpgsql immutable set search_path=public as $$ declare x jsonb;begin
 if jsonb_typeof(v) is distinct from 'array' then return false;end if;
 if jsonb_array_length(v)<>7 then return false;end if;
 for x in select value from jsonb_array_elements(v) loop
  if x='null'::jsonb then continue;end if;
  if jsonb_typeof(x)<>'number' then return false;end if;
  if (x::text)::numeric<0 then return false;end if;
 end loop;return true;
end $$;
alter table public.generator_load_entries drop constraint if exists generator_load_entries_values;
alter table public.generator_load_entries add constraint generator_load_entries_values check(m2_ops.valid_generator_loads(band_loads));
create index if not exists generator_load_entries_report on public.generator_load_entries(report_id);
alter table public.generator_load_entries enable row level security;
drop policy if exists generator_load_entries_read on public.generator_load_entries;
create policy generator_load_entries_read on public.generator_load_entries for select to authenticated
 using(public.is_manager() or public.can_fill_generation() or public.can_fill_distribution() or public.has_page('generation'));
revoke all on public.generator_load_entries from public,anon,authenticated;
grant select on public.generator_load_entries to authenticated;
create table if not exists m2_ops.generator_load_receipts(operation uuid primary key,actor uuid not null,created_at timestamptz not null default now());
revoke all on m2_ops.generator_load_receipts from public,anon,authenticated;

create or replace function m2_ops.generator_bands7(v jsonb) returns jsonb
language sql immutable set search_path=public as $$
 select case when v is null then '[null,null,null,null,null,null,null]'::jsonb when jsonb_array_length(v)=6 then v||'[null]'::jsonb else v end
$$;
create or replace function public.generator_load_day_editable(p_date date) returns boolean
language sql stable security definer set search_path=public as $$
 select (public.is_manager() or public.can_fill_distribution()) and p_date<=(public.server_now() at time zone 'Asia/Gaza')::date and
 (public.is_manager() or (not exists(select 1 from distribution_sheets where sheet_date=p_date and status in ('submitted','approved'))
 and not exists(select 1 from site_reports where report_date=p_date and status in ('submitted','approved'))))
$$;
create or replace function public.generator_loads_for_day(p_date date)
returns table(generator_id smallint,name text,brand text,capacity_kva numeric,load_unit text,band_loads jsonb,editable boolean)
language plpgsql stable security definer set search_path=public as $$begin
 if public.current_employee_id() is null or not(public.is_manager() or public.can_fill_distribution() or public.can_fill_generation() or public.has_page('generation')) then raise exception 'not_allowed' using errcode='42501';end if;
 return query select g.id,g.name,g.brand,g.capacity_kva,coalesce(e.load_unit,l.load_unit,'A'::load_unit)::text,
 coalesce(e.band_loads,m2_ops.generator_bands7(l.band_loads)),public.generator_load_day_editable(p_date)
 from generators g left join site_reports r on r.report_date=p_date
 left join generator_day_logs l on l.report_id=r.id and l.generator_id=g.id
 left join generator_load_entries e on e.load_date=p_date and e.generator_id=g.id
 where g.is_active or e.id is not null or l.id is not null
 order by case when lower(g.brand) like '%caterpillar%' then 0 else 1 end,g.sort_order,g.id;
end $$;
create or replace function public.generator_load_patch(p_date date,p_generator smallint,p_changes jsonb,p_unit text,p_operation uuid,p_actor uuid) returns void
language plpgsql security definer set search_path=public as $$
declare me uuid:=public.current_employee_id();entry generator_load_entries%rowtype;vals jsonb;unit public.load_unit;rid uuid;k text;v jsonb;
begin
 if me is null or me is distinct from p_actor or not(public.is_manager() or public.can_fill_distribution()) then raise exception 'not_allowed' using errcode='42501';end if;
 if p_operation is null then raise exception 'operation_required';end if;
 if exists(select 1 from m2_ops.generator_load_receipts where operation=p_operation and actor=me) then return;end if;
 perform pg_advisory_xact_lock(92407,hashtext(p_date::text));
 if exists(select 1 from m2_ops.generator_load_receipts where operation=p_operation and actor=me) then return;end if;
 perform 1 from site_reports where report_date=p_date for update;
 perform 1 from distribution_sheets where sheet_date=p_date for update;
 if p_date is null or not public.generator_load_day_editable(p_date) then raise exception 'generator_load_day_closed';end if;
 if jsonb_typeof(p_changes) is distinct from 'object' then raise exception 'invalid_load_changes';end if;
 perform 1 from generators where id=p_generator;if not found then raise exception 'generator_not_found';end if;
 select * into entry from generator_load_entries where load_date=p_date and generator_id=p_generator for update;
 select id into rid from site_reports where report_date=p_date;
 if entry.id is not null then vals:=entry.band_loads;unit:=entry.load_unit;
 else select m2_ops.generator_bands7(l.band_loads),l.load_unit into vals,unit from generator_day_logs l where l.report_id=rid and l.generator_id=p_generator;
 end if;
 vals:=coalesce(vals,m2_ops.generator_bands7(null));unit:=coalesce(unit,'A');
 if p_unit is not null then if p_unit not in ('A','kW') then raise exception 'invalid_load_unit';end if;unit:=p_unit::public.load_unit;end if;
 for k,v in select key,value from jsonb_each(p_changes) loop
  if k !~ '^[0-6]$' then raise exception 'invalid_load_band';end if;
  vals:=jsonb_set(vals,array[k],v,false);
 end loop;
 if not m2_ops.valid_generator_loads(vals) then raise exception 'invalid_load_value';end if;
 if entry.id is null or entry.band_loads is distinct from vals or entry.load_unit is distinct from unit then
  insert into generator_load_entries(load_date,generator_id,report_id,load_unit,band_loads,updated_by,updated_at)
   values(p_date,p_generator,rid,unit,vals,me,clock_timestamp())
   on conflict(load_date,generator_id) do update set report_id=excluded.report_id,load_unit=excluded.load_unit,band_loads=excluded.band_loads,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 end if;
 insert into m2_ops.generator_load_receipts(operation,actor) values(p_operation,me);
end $$;
-- Touch only report metadata so the existing incremental/live pull sees the new readings.
create or replace function m2_ops.generator_load_touch_report() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if new.report_id is not null then update site_reports set updated_at=clock_timestamp() where id=new.report_id;end if;return new;
end $$;
drop trigger if exists generator_load_touch_report on public.generator_load_entries;
create trigger generator_load_touch_report after insert or update on public.generator_load_entries for each row execute function m2_ops.generator_load_touch_report();
create or replace function m2_ops.lock_generator_load_day() returns trigger
language plpgsql set search_path=public as $$begin
 perform pg_advisory_xact_lock(92407,hashtext(new.report_date::text));return new;
end $$;
drop trigger if exists lock_generator_load_day on public.site_reports;
create trigger lock_generator_load_day before insert on public.site_reports for each row execute function m2_ops.lock_generator_load_day();
create or replace function m2_ops.attach_generator_loads() returns trigger
language plpgsql security definer set search_path=public as $$begin
 update generator_load_entries set report_id=new.id where load_date=new.report_date and report_id is null;return new;
end $$;
drop trigger if exists attach_generator_loads on public.site_reports;
create trigger attach_generator_loads after insert on public.site_reports for each row execute function m2_ops.attach_generator_loads();
revoke all on function m2_ops.valid_generator_loads(jsonb),m2_ops.generator_bands7(jsonb),m2_ops.generator_load_touch_report(),m2_ops.attach_generator_loads(),m2_ops.lock_generator_load_day() from public,anon,authenticated;
revoke all on function public.generator_load_day_editable(date),public.generator_loads_for_day(date),public.generator_load_patch(date,smallint,jsonb,text,uuid,uuid) from public,anon;
grant execute on function public.generator_load_day_editable(date),public.generator_loads_for_day(date),public.generator_load_patch(date,smallint,jsonb,text,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
