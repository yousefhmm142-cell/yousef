-- =====================================================================
--  نظام مخيم 2: إغلاق اليوم وإعادة فتحه، معدل استهلاك المولدات، المخزن، والنسخ الاحتياطي اليومي
--  لمشروع شُغّل عليه setup.sql من قبل: الصق هذا الملف في SQL Editor ثم Run، مرة واحدة.
-- =====================================================================

-- ---------- 1. Closing the day: the manager may reopen a closed day, even an approved one ----------
create or replace function public.sheet_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.user_role := public.current_user_role();
  me uuid := public.current_employee_id();
  site boolean := r in ('generation_operator', 'distribution_supervisor');
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
      or (old.status = 'approved' and new.status = 'returned')) then
      raise exception 'The manager can approve a closed day or reopen it';
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

-- ---------- 2. Diesel per running hour of each generator, and how far the typed figure may drift ----------
alter table public.generators add column liters_per_hour numeric check (liters_per_hour > 0);
alter table public.app_settings
  add column expected_warn_pct smallint not null default 15,
  add column expected_danger_pct smallint not null default 30;

-- ---------- 3. Warehouse ----------
create table public.stock_items (
  id smallint generated always as identity primary key,
  name text not null unique,
  unit text not null default 'قطعة',
  min_qty numeric not null default 0 check (min_qty >= 0),
  is_active boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);

create type public.stock_move_kind as enum ('in', 'out');

-- Balance of an item = everything in − everything out. Nothing is edited: a mistake is deleted
-- (and kept in the change history) and entered again.
create table public.stock_moves (
  id uuid primary key default gen_random_uuid(),
  item_id smallint not null references public.stock_items (id),
  kind public.stock_move_kind not null,
  qty numeric not null check (qty > 0),
  at timestamptz not null default now(),
  note text,
  ref text,
  task_id uuid references public.tasks (id) on delete set null,
  created_by uuid references public.employees (id),
  created_at timestamptz not null default now()
);
create index stock_moves_item on public.stock_moves (item_id, at);
create index stock_moves_task on public.stock_moves (task_id);

create function public.stock_move_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.created_by := coalesce(public.current_employee_id(), nullif(current_setting('m2.acting_employee', true), '')::uuid, new.created_by);
  return new;
end $$;
create trigger stock_moves_stamp before insert on public.stock_moves
  for each row execute function public.stock_move_stamp();

alter table public.stock_items enable row level security;
alter table public.stock_moves enable row level security;
create policy stock_items_read on public.stock_items for select to authenticated using (public.current_employee_id() is not null);
create policy stock_items_manage on public.stock_items for all to authenticated using (public.is_manager()) with check (public.is_manager());
create policy stock_moves_manage on public.stock_moves for all to authenticated using (public.is_manager()) with check (public.is_manager());
grant select, insert, update, delete on public.stock_items, public.stock_moves to authenticated;
create trigger stock_items_audit after update or delete on public.stock_items for each row execute function public.audit_row();
create trigger stock_moves_audit after update or delete on public.stock_moves for each row execute function public.audit_row();

insert into public.stock_items (name, unit, min_qty, sort_order) values
  ('طبلون عدادين', 'قطعة', 2, 1),
  ('طبلون 3 عدادات', 'قطعة', 2, 2),
  ('طبلون 4 عدادات', 'قطعة', 2, 3),
  ('عداد كهرباء', 'قطعة', 5, 4),
  ('كابل 4×6', 'متر', 100, 5),
  ('كابل 2×16', 'متر', 100, 6),
  ('قاطع 32A', 'قطعة', 5, 7);

-- ---------- 4. The technician's link: what he used comes off the warehouse ----------
create or replace function public.task_link_view(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.tasks;
begin
  select * into t from public.tasks where link_token = p_token;
  if not found then return null; end if;
  if t.status in ('new', 'sent') then
    perform set_config('m2.acting_employee', t.assignee_id::text, true);
    update public.tasks set status = 'seen' where id = t.id returning * into t;
    perform set_config('m2.acting_employee', '', true);
  end if;
  return jsonb_build_object(
    'number', t.number,
    'type', (select name from public.task_types where id = t.task_type_id),
    'assignee', (select full_name from public.employees where id = t.assignee_id),
    'details', t.details,
    'subscriber_name', t.subscriber_name,
    'subscriber_phone', t.subscriber_phone,
    'zone', (select name from public.zones where id = t.zone_id),
    'location', t.location_text,
    'priority', t.priority,
    'expected_minutes', t.expected_minutes,
    'status', t.status,
    'sent_at', t.sent_at,
    'started_at', t.started_at,
    'completed_at', t.completed_at,
    'completion_notes', t.completion_notes,
    -- The list to pick used materials from, and what was recorded for this task.
    'items', case when t.status in ('done', 'cancelled') then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'unit', i.unit) order by i.sort_order, i.id)
      from public.stock_items i where i.is_active), '[]'::jsonb) end,
    'materials', coalesce((
      select jsonb_agg(jsonb_build_object('name', i.name, 'unit', i.unit, 'qty', m.qty) order by m.created_at)
      from public.stock_moves m join public.stock_items i on i.id = m.item_id
      where m.task_id = t.id and m.kind = 'out'), '[]'::jsonb)
  );
end $$;

drop function public.task_link_act(text, text, text);
create function public.task_link_act(p_token text, p_action text, p_notes text default null, p_materials jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.tasks;
  m jsonb;
begin
  select * into t from public.tasks where link_token = p_token for update;
  if not found then raise exception 'not_found'; end if;
  if t.status = 'cancelled' then raise exception 'cancelled'; end if;
  if p_action not in ('start', 'done') then raise exception 'bad_action'; end if;

  perform set_config('m2.acting_employee', t.assignee_id::text, true);
  if t.status in ('new', 'sent', 'seen') then
    update public.tasks set status = 'in_progress' where id = t.id;
  end if;
  if p_action = 'done' and t.status <> 'done' then
    update public.tasks set status = 'done', completion_notes = nullif(btrim(coalesce(p_notes, '')), '') where id = t.id;
    -- Materials used: [{"item_id": 4, "qty": 1}, ...]; only active items and positive amounts count.
    for m in select * from jsonb_array_elements(coalesce(p_materials, '[]'::jsonb)) loop
      if (m ->> 'qty')::numeric > 0 and exists (select 1 from public.stock_items where id = (m ->> 'item_id')::smallint and is_active) then
        insert into public.stock_moves (item_id, kind, qty, note, task_id)
          values ((m ->> 'item_id')::smallint, 'out', (m ->> 'qty')::numeric, 'مهمة #' || t.number, t.id);
      end if;
    end loop;
  end if;
  perform set_config('m2.acting_employee', '', true);
  return public.task_link_view(p_token);
end $$;

revoke execute on function public.task_link_act(text, text, text, jsonb) from public;
grant execute on function public.task_link_act(text, text, text, jsonb) to anon, authenticated;

-- ---------- 5. A copy of everything every night, the last 30 kept ----------
-- Inside this same database: it protects against a wrong delete or edit. The weekly download in
-- settings is still the copy that survives losing the whole project.
create table public.backups (
  id bigint generated always as identity primary key,
  taken_at timestamptz not null default now(),
  size_bytes integer not null,
  data jsonb not null
);
alter table public.backups enable row level security;
create policy backups_read on public.backups for select to authenticated using (public.is_manager());
grant select on public.backups to authenticated;

create function public.take_backup() returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_data jsonb := '{}'::jsonb;
  v_rows jsonb;
  v_id bigint;
  t text;
begin
  foreach t in array array[
    'work_schedules', 'app_settings', 'holidays', 'employees', 'generators', 'fuel_types', 'zones', 'task_types',
    'site_reports', 'site_report_fuel', 'generator_day_logs', 'generator_runs', 'maintenance_logs',
    'distribution_sheets', 'zone_day_entries', 'zone_runs', 'tasks', 'task_events', 'outgoing_messages',
    'attendance_points', 'attendance_punches', 'leaves', 'stock_items', 'stock_moves'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into v_rows;
    v_data := v_data || jsonb_build_object(t, v_rows);
  end loop;
  insert into public.backups (size_bytes, data)
    values (octet_length(v_data::text), jsonb_build_object('app', 'mukhayyam2', 'version', 1, 'tables', v_data))
    returning id into v_id;
  -- Keep the last 30, and never more than about 150 MB of copies (the free plan has 500 MB).
  delete from public.backups where id not in (select id from public.backups order by id desc limit 30);
  while (select coalesce(sum(size_bytes), 0) from public.backups) > 150000000
        and (select count(*) from public.backups) > 3 loop
    delete from public.backups where id = (select min(id) from public.backups);
  end loop;
  return v_id;
end $$;

-- The list in settings (without the copies themselves, which are fetched one at a time).
create function public.backup_list() returns table (id bigint, taken_at timestamptz, size_bytes integer)
language sql stable security definer set search_path = public as $$
  select b.id, b.taken_at, b.size_bytes from public.backups b where public.is_manager() order by b.id desc
$$;

revoke execute on function public.take_backup() from public, anon, authenticated;
revoke execute on function public.backup_list() from public, anon;
grant execute on function public.backup_list() to authenticated;

-- Every night at 00:30 UTC (02:30 or 03:30 in Gaza), with Supabase's scheduler (pg_cron).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('m2-daily-backup', '30 0 * * *', 'select public.take_backup()');
  else
    raise notice 'pg_cron is not available here: no nightly copy is scheduled';
  end if;
end $$;
select public.take_backup();

-- Tell the Data API about the new tables and functions right away.
notify pgrst, 'reload schema';
