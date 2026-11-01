-- =====================================================================
--  نظام مخيم 2: الأختام (رولات الأختام، صرفها للفنيين، تسجيل استخدامها)
-- =====================================================================
-- A roll holds 100 numbered seals (181301-181400). Seals are taken out in batches of about ten and
-- handed to a technician (only technicians) on a day; later the technician reports where each seal
-- was fitted (tableau number, work, subscriber), or that it was damaged or lost.
--
-- Who: the manager and the admin, and anyone the admin gives «صلاحية الأختام» (employees.can_seals).
-- Everything is written through the functions below, never straight into the tables.

alter table public.employees add column if not exists can_seals boolean not null default false;

create or replace function public.has_seals() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager() or coalesce((
    select e.can_seals and e.is_active from public.employees e where e.id = public.current_employee_id()
  ), false)
$$;
revoke execute on function public.has_seals() from anon, public;
grant execute on function public.has_seals() to authenticated;

-- The settings screen gives or takes away the permission.
create or replace function public.admin_set_seals_access(p_id uuid, p_value boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.employees set can_seals = coalesce(p_value, false) where id = p_id;
  if not found then raise exception 'missing'; end if;
end $$;
revoke execute on function public.admin_set_seals_access(uuid, boolean) from anon, public;
grant execute on function public.admin_set_seals_access(uuid, boolean) to authenticated;

-- ---------- Tables ----------
create table public.seal_rolls (
  id uuid primary key default gen_random_uuid(),
  from_no integer not null check (from_no > 0),
  to_no integer not null,
  received_on date not null,
  note text check (note is null or length(note) <= 200),
  created_by uuid references public.employees (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (to_no >= from_no and to_no - from_no < 1000)
);
create index seal_rolls_from on public.seal_rolls (from_no);

create table public.seal_batches (
  id uuid primary key default gen_random_uuid(),
  roll_id uuid not null references public.seal_rolls (id) on delete cascade,
  batch_no smallint not null check (batch_no > 0),
  technician_id uuid not null references public.employees (id),
  issued_on date not null,
  note text check (note is null or length(note) <= 200),
  created_by uuid references public.employees (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (roll_id, batch_no)
);
create index seal_batches_tech on public.seal_batches (technician_id);

create table public.seals (
  seal_no integer primary key,
  roll_id uuid not null references public.seal_rolls (id) on delete cascade,
  status text not null default 'in_stock' check (status in ('in_stock', 'issued', 'used', 'damaged', 'lost')),
  batch_id uuid references public.seal_batches (id) on delete set null,
  batch_pos smallint,
  technician_id uuid references public.employees (id),
  issued_on date,
  used_on date,
  details text check (details is null or length(details) <= 500),
  board_no text,
  updated_by uuid references public.employees (id),
  updated_at timestamptz not null default now()
);
create index seals_roll on public.seals (roll_id);
create index seals_batch on public.seals (batch_id);
create index seals_tech_status on public.seals (technician_id, status);
create index seals_board on public.seals (board_no);
create index seals_updated on public.seals (updated_at);

create trigger seal_rolls_touch before update on public.seal_rolls for each row execute function public.touch_updated_at();
create trigger seal_batches_touch before update on public.seal_batches for each row execute function public.touch_updated_at();
create trigger seals_touch before update on public.seals for each row execute function public.touch_updated_at();

-- Change history: the audit trigger reads the row's id; seals are identified by their number.
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
begin
  if tg_op = 'UPDATE' and (o - 'updated_at') = (n - 'updated_at') then
    return new;
  end if;
  insert into public.audit_log (table_name, record_id, action, actor_id, old_row, new_row)
    values (tg_table_name, coalesce(coalesce(n, o) ->> 'id', coalesce(n, o) ->> 'seal_no'), lower(tg_op), public.current_employee_id(), o, n);
  return coalesce(new, old);
end $$;
create trigger seal_rolls_audit after update or delete on public.seal_rolls for each row execute function public.audit_row();
create trigger seal_batches_audit after update or delete on public.seal_batches for each row execute function public.audit_row();
create trigger seals_audit after update or delete on public.seals for each row execute function public.audit_row();

-- ---------- Row rules: read for those with the permission; writing only through the functions ----------
alter table public.seal_rolls enable row level security;
alter table public.seal_batches enable row level security;
alter table public.seals enable row level security;
create policy seal_rolls_read on public.seal_rolls for select to authenticated using (public.has_seals());
create policy seal_batches_read on public.seal_batches for select to authenticated using (public.has_seals());
create policy seals_read on public.seals for select to authenticated using (public.has_seals());
revoke all on public.seal_rolls, public.seal_batches, public.seals from anon, public;
revoke insert, update, delete, truncate on public.seal_rolls, public.seal_batches, public.seals from authenticated;
grant select on public.seal_rolls, public.seal_batches, public.seals to authenticated;

-- ---------- Helpers ----------
/** "طبلون 361 إعادة شبك" -> 361; "طبلون الحملاوي 27 (تفتيش)" -> "الحملاوي 27". */
create function public.seal_board_no(p_details text) returns text
language sql immutable as $$
  select nullif(btrim(coalesce((regexp_match(coalesce(p_details, ''), 'طبلون(?:ات)?\s*(?:رقم\s*)?([^\s()+،,]+(?:\s+[0-9]+)?)'))[1], ''), ' ()'), '')
$$;

/** Names compared without hamza, taa marbuta, ya dots and spaces. */
create function public.seal_name_key(p_name text) returns text
language sql immutable as $$
  select regexp_replace(translate(coalesce(p_name, ''), 'أإآةىـ', 'اااهي'), '\s+', '', 'g')
$$;

create function public.seal_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Gaza')::date $$;

-- ---------- Functions ----------
-- A new roll: its 100 (or so) numbers all start «in stock».
create function public.seal_add_roll(p_from integer, p_to integer, p_received date, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_to integer := coalesce(p_to, p_from + 99);
  v_id uuid;
begin
  if not public.has_seals() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_from is null or p_from <= 0 or v_to < p_from or v_to - p_from >= 1000 then raise exception 'bad_range'; end if;
  if p_received is null or p_received > public.seal_today() + 1 then raise exception 'bad_date'; end if;
  if exists (select 1 from public.seal_rolls where from_no <= v_to and to_no >= p_from) then raise exception 'roll_overlap'; end if;
  insert into public.seal_rolls (from_no, to_no, received_on, note, created_by)
    values (p_from, v_to, p_received, nullif(btrim(coalesce(p_note, '')), ''), public.current_employee_id())
    returning id into v_id;
  insert into public.seals (seal_no, roll_id, updated_by)
    select g, v_id, public.current_employee_id() from generate_series(p_from, v_to) g;
  return v_id;
end $$;

-- Hands a batch of seals (typed in the order they were taken) to a technician.
create function public.seal_issue(p_technician uuid, p_issued_on date, p_seals integer[], p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_employee_id();
  v_n integer := coalesce(array_length(p_seals, 1), 0);
  v_roll uuid;
  v_rolls integer;
  v_bad integer;
  v_batch uuid;
  v_no integer;
begin
  if not public.has_seals() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if v_n = 0 or v_n > 100 then raise exception 'no_seals'; end if;
  if (select count(distinct x) from unnest(p_seals) x) <> v_n then raise exception 'duplicate_seal'; end if;
  if not exists (select 1 from public.employees where id = p_technician and role = 'technician' and is_active) then
    raise exception 'bad_technician';
  end if;
  if p_issued_on is null or p_issued_on > public.seal_today() + 1 then raise exception 'bad_date'; end if;

  perform 1 from public.seals where seal_no = any (p_seals) order by seal_no for update;
  select x into v_bad from unnest(p_seals) x where not exists (select 1 from public.seals s where s.seal_no = x) limit 1;
  if v_bad is not null then raise exception 'unknown_seal:%', v_bad; end if;
  select s.seal_no into v_bad from public.seals s where s.seal_no = any (p_seals) and s.status <> 'in_stock' order by s.seal_no limit 1;
  if v_bad is not null then raise exception 'not_available:%', v_bad; end if;
  select count(distinct roll_id), min(roll_id::text)::uuid into v_rolls, v_roll from public.seals where seal_no = any (p_seals);
  if v_rolls > 1 then raise exception 'mixed_rolls'; end if;

  select coalesce(max(batch_no), 0) + 1 into v_no from public.seal_batches where roll_id = v_roll;
  insert into public.seal_batches (roll_id, batch_no, technician_id, issued_on, note, created_by)
    values (v_roll, v_no, p_technician, p_issued_on, nullif(btrim(coalesce(p_note, '')), ''), v_me)
    returning id into v_batch;
  update public.seals s
     set status = 'issued', batch_id = v_batch, batch_pos = o.pos, technician_id = p_technician,
         issued_on = p_issued_on, used_on = null, details = null, board_no = null, updated_by = v_me
    from unnest(p_seals) with ordinality as o (no, pos)
   where s.seal_no = o.no;
  return jsonb_build_object('batch_id', v_batch, 'batch_no', v_no, 'roll_id', v_roll, 'count', v_n);
end $$;

-- Takes seals back to stock (an entry made by mistake). Only ones not used yet.
create function public.seal_unissue(p_seals integer[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_employee_id();
  v_done integer;
begin
  if not public.has_seals() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if exists (select 1 from public.seals where seal_no = any (p_seals) and status not in ('issued', 'in_stock')) then
    raise exception 'already_used';
  end if;
  update public.seals
     set status = 'in_stock', batch_id = null, batch_pos = null, technician_id = null, issued_on = null,
         used_on = null, details = null, board_no = null, updated_by = v_me
   where seal_no = any (p_seals) and status = 'issued';
  get diagnostics v_done = row_count;
  delete from public.seal_batches b where not exists (select 1 from public.seals s where s.batch_id = b.id);
  return v_done;
end $$;

-- What happened to a seal: used (with details), damaged, lost, or back to "issued" (undo).
create function public.seal_record(p_seal integer, p_status text, p_date date, p_details text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_employee_id();
  s public.seals;
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
begin
  if not public.has_seals() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_status not in ('used', 'damaged', 'lost', 'issued') then raise exception 'bad_status'; end if;
  select * into s from public.seals where seal_no = p_seal for update;
  if not found then raise exception 'unknown_seal:%', p_seal; end if;
  if p_status in ('used', 'issued') and s.technician_id is null then raise exception 'not_issued:%', p_seal; end if;
  if p_date is not null and p_date > public.seal_today() + 1 then raise exception 'bad_date'; end if;
  if p_status = 'issued' then
    update public.seals set status = 'issued', used_on = null, details = null, board_no = null, updated_by = v_me where seal_no = p_seal;
  else
    update public.seals
       set status = p_status, used_on = coalesce(p_date, public.seal_today()), details = v_details,
           board_no = public.seal_board_no(v_details), updated_by = v_me
     where seal_no = p_seal;
  end if;
end $$;

-- A roll entered by mistake: only while none of its seals left the stock.
create function public.seal_delete_roll(p_roll uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if exists (select 1 from public.seals where roll_id = p_roll and status <> 'in_stock') then raise exception 'roll_in_use'; end if;
  delete from public.seal_rolls where id = p_roll;
end $$;

-- ---------- Loading the old Excel files (manager only) ----------
-- A technician named in the files who is not in the system yet is added switched off, so the old
-- records keep their name; the same person under a slightly different spelling is matched.
create function public.seal_import_technician(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_key text := public.seal_name_key(v_name);
  v_words text[] := regexp_split_to_array(v_name, '\s+');
  v_id uuid;
  v_n integer;
begin
  if not public.is_manager() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if length(v_name) < 2 then raise exception 'bad_name'; end if;
  -- 1. The same name, ignoring hamza, taa marbuta and spaces.
  select id into v_id from public.employees
   where public.seal_name_key(full_name) = v_key order by is_active desc, created_at limit 1;
  -- 2. The same first and last word («قصي الشافعي» for «قصي كمال الشافعي»), when only one fits.
  if v_id is null and array_length(v_words, 1) >= 2 then
    select count(*), min(id::text)::uuid into v_n, v_id from public.employees e
     where e.role = 'technician'
       and public.seal_name_key((regexp_split_to_array(btrim(e.full_name), '\s+'))[1]) = public.seal_name_key(v_words[1])
       and public.seal_name_key((regexp_split_to_array(btrim(e.full_name), '\s+'))[array_length(regexp_split_to_array(btrim(e.full_name), '\s+'), 1)]) = public.seal_name_key(v_words[array_length(v_words, 1)]);
    if v_n <> 1 then v_id := null; end if;
  end if;
  -- 3. A single word («مجد»), or words run together («بشارالشافعي»): one technician starting and ending like it.
  if v_id is null then
    select count(*), min(id::text)::uuid into v_n, v_id from public.employees e
     where e.role = 'technician'
       and ((array_length(v_words, 1) = 1 and length(v_key) <= 6 and public.seal_name_key(e.full_name) like v_key || '%')
         or (array_length(v_words, 1) = 1 and length(v_key) > 6
             and public.seal_name_key(e.full_name) like left(v_key, 4) || '%' and public.seal_name_key(e.full_name) like '%' || right(v_key, 5)));
    if v_n <> 1 then v_id := null; end if;
  end if;
  if v_id is null then
    insert into public.employees (full_name, role, is_active, tracks_attendance) values (v_name, 'technician', false, false) returning id into v_id;
  end if;
  return v_id;
end $$;

-- One roll with everything known about it: its batches, damaged seals, and what was done with each.
-- Safe to run again: a roll already there is skipped.
create function public.seal_import_roll(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_employee_id();
  v_from integer := (p ->> 'from')::integer;
  v_to integer := (p ->> 'to')::integer;
  v_roll uuid;
  b jsonb;
  v_batch uuid;
  v_no integer := 0;
  v_issued integer := 0;
  v_outside integer := 0;
  v_used integer := 0;
  v_unmatched integer := 0;
  v_cnt integer;
begin
  if not public.is_manager() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if exists (select 1 from public.seal_rolls where from_no = v_from and to_no = v_to) then
    return jsonb_build_object('skipped', true);
  end if;
  if v_from is null or v_to < v_from or v_to - v_from >= 1000 then raise exception 'bad_range'; end if;
  if exists (select 1 from public.seal_rolls where from_no <= v_to and to_no >= v_from) then raise exception 'roll_overlap'; end if;

  insert into public.seal_rolls (from_no, to_no, received_on, note, created_by)
    values (v_from, v_to, (p ->> 'received_on')::date, nullif(p ->> 'note', ''), v_me) returning id into v_roll;
  insert into public.seals (seal_no, roll_id, updated_by) select g, v_roll, v_me from generate_series(v_from, v_to) g;

  for b in select * from jsonb_array_elements(coalesce(p -> 'batches', '[]'::jsonb)) loop
    v_no := v_no + 1;
    insert into public.seal_batches (roll_id, batch_no, technician_id, issued_on, created_by)
      values (v_roll, v_no, (b ->> 'tech')::uuid, (b ->> 'date')::date, v_me) returning id into v_batch;
    update public.seals s
       set status = 'issued', batch_id = v_batch, batch_pos = o.pos, technician_id = (b ->> 'tech')::uuid,
           issued_on = (b ->> 'date')::date, updated_by = v_me
      from jsonb_array_elements_text(b -> 'seals') with ordinality as o (no, pos)
     where s.seal_no = o.no::integer and s.roll_id = v_roll and s.status = 'in_stock';
    get diagnostics v_cnt = row_count;
    v_issued := v_issued + v_cnt;
    v_outside := v_outside + (jsonb_array_length(b -> 'seals') - v_cnt);
  end loop;
  delete from public.seal_batches bb where bb.roll_id = v_roll and not exists (select 1 from public.seals s where s.batch_id = bb.id);

  update public.seals set status = 'damaged', updated_by = v_me
   where roll_id = v_roll and status = 'in_stock' and seal_no in (select x::integer from jsonb_array_elements_text(coalesce(p -> 'damaged', '[]'::jsonb)) x);

  update public.seals s
     set status = u.status, used_on = nullif(u.used_on, '')::date, details = nullif(btrim(u.details), ''),
         board_no = public.seal_board_no(u.details), updated_by = v_me
    from jsonb_to_recordset(coalesce(p -> 'usage', '[]'::jsonb)) as u (no integer, status text, used_on text, details text)
   where s.seal_no = u.no and s.roll_id = v_roll and u.status in ('used', 'damaged', 'lost')
     and (s.status = 'issued' or (u.status = 'damaged' and s.status in ('in_stock', 'damaged')));
  get diagnostics v_used = row_count;
  v_unmatched := jsonb_array_length(coalesce(p -> 'usage', '[]'::jsonb)) - v_used;

  return jsonb_build_object('roll_id', v_roll, 'batches', v_no, 'issued', v_issued, 'outside', v_outside, 'used', v_used, 'unmatched', v_unmatched);
end $$;

revoke execute on function public.seal_board_no(text), public.seal_name_key(text), public.seal_today() from anon, public;
grant execute on function public.seal_board_no(text), public.seal_name_key(text), public.seal_today() to authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'seal_add_roll(integer, integer, date, text)', 'seal_issue(uuid, date, integer[], text)', 'seal_unissue(integer[])',
    'seal_record(integer, text, date, text)', 'seal_delete_roll(uuid)', 'seal_import_technician(text)', 'seal_import_roll(jsonb)'] loop
    execute format('revoke execute on function public.%s from anon, public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- The nightly copy takes the seals too.
create or replace function public.take_backup() returns bigint
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
    'attendance_points', 'attendance_punches', 'leaves', 'stock_items', 'stock_moves',
    'seal_rolls', 'seal_batches', 'seals'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into v_rows;
    v_data := v_data || jsonb_build_object(t, v_rows);
  end loop;
  insert into public.backups (size_bytes, data)
    values (octet_length(v_data::text), jsonb_build_object('app', 'mukhayyam2', 'version', 1, 'tables', v_data))
    returning id into v_id;
  delete from public.backups where id not in (select id from public.backups order by id desc limit 30);
  while (select coalesce(sum(size_bytes), 0) from public.backups) > 150000000
        and (select count(*) from public.backups) > 3 loop
    delete from public.backups where id = (select min(id) from public.backups);
  end loop;
  return v_id;
end $$;
revoke execute on function public.take_backup() from public, anon, authenticated;

notify pgrst, 'reload schema';
