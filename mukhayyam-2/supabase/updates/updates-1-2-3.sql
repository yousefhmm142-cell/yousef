-- =====================================================================
--  نظام مخيم 2: التحديثات 1 و2 و3 معاً (موظف الموقع، روابط المهام، الحضور بالـ QR)
--  لمشروع شُغّل عليه setup.sql من قبل: الصق هذا الملف كاملاً في SQL Editor ثم Run، مرة واحدة.
-- =====================================================================
do $$
begin
  if to_regclass('public.employees') is null then
    raise exception 'شغّل setup.sql أولاً (setup.sql was not run yet)';
  end if;
  if to_regclass('public.attendance_codes') is not null then
    raise exception 'هذه التحديثات مطبّقة من قبل، لا داعي لتشغيلها مرة ثانية (already applied)';
  end if;
end $$;

-- ===================== 20261030000004_site_staff.sql =====================

-- =====================================================================
--  نظام مخيم 2: تحديث صلاحيات موظف موقع التوليد
--  لمشروع شُغّل عليه setup.sql من قبل: الصق هذا الملف في SQL Editor ثم Run، مرة واحدة.
-- =====================================================================
-- The people at the generation site fill both daily forms: the generation report and the
-- distribution sheet. Both site roles (generation_operator, distribution_supervisor) now act the
-- same on both; managers are unchanged.

create or replace function public.is_site_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('generation_operator', 'distribution_supervisor')
$$;

-- Same steps as before (draft -> submitted -> approved / returned); "site staff" replaces the one
-- filler role per sheet.
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
    if r = 'manager' and not (old.status = 'submitted' and new.status in ('approved', 'returned')) then
      raise exception 'The manager can only approve or return a sent sheet';
    end if;
    if not site and r is distinct from 'manager' and r is distinct from 'admin' then
      raise exception 'Not allowed';
    end if;
    if new.status = 'submitted' then
      new.submitted_by := me;
      -- No lower bound from created_at: a sheet filled offline reaches the server (and is created
      -- there) only when the phone reconnects, after it was really sent.
      new.submitted_at := public.event_time(new.recorded_offline, new.device_time, null);
      new.returned_reason := null;
    elsif new.status = 'approved' then
      new.approved_by := me;
      new.approved_at := now();
    elsif new.status = 'returned' then
      if length(btrim(coalesce(new.returned_reason, ''))) = 0 then
        raise exception 'Returning a sheet needs a reason';
      end if;
      new.approved_by := null; new.approved_at := null;
    end if;
  else
    -- Server-owned columns cannot be changed by hand.
    new.submitted_by := old.submitted_by; new.submitted_at := old.submitted_at;
    new.approved_by := old.approved_by; new.approved_at := old.approved_at;
  end if;
  new.created_by := old.created_by;
  return new;
end $$;

create or replace function public.site_report_editable(p_report_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager() or (
    public.is_site_staff()
    and exists (select 1 from public.site_reports where id = p_report_id and status in ('draft', 'returned'))
  )
$$;

create or replace function public.distribution_sheet_editable(p_sheet_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager() or (
    public.is_site_staff()
    and exists (select 1 from public.distribution_sheets where id = p_sheet_id and status in ('draft', 'returned'))
  )
$$;

-- Reading and starting either form: managers and the site.
do $$
declare t text;
begin
  foreach t in array array['site_reports', 'distribution_sheets'] loop
    execute format('alter policy %I on public.%I using (public.is_manager() or public.is_site_staff())', t || '_read', t);
    execute format('alter policy %I on public.%I with check (public.is_manager() or public.is_site_staff())', t || '_insert', t);
    execute format('alter policy %I on public.%I using (public.is_manager() or public.is_site_staff()) with check (public.is_manager() or public.is_site_staff())', t || '_update', t);
  end loop;
  foreach t in array array['site_report_fuel', 'generator_day_logs', 'generator_runs', 'maintenance_logs', 'zone_day_entries', 'zone_runs'] loop
    execute format('alter policy %I on public.%I using (public.is_manager() or public.is_site_staff())', t || '_read', t);
  end loop;
end $$;

revoke execute on function public.is_site_staff() from anon, public;
grant execute on function public.is_site_staff() to authenticated;

-- Tell the Data API about the new function right away.
notify pgrst, 'reload schema';

-- ===================== 20261030000005_task_links.sql =====================

-- =====================================================================
--  نظام مخيم 2: روابط المهام للفنيين (بدون تطبيق وبدون دخول)
--  لمشروع شُغّل عليه setup.sql من قبل: الصق هذا الملف في SQL Editor ثم Run، مرة واحدة.
-- =====================================================================
-- Technicians have no app and no login. The manager sends the order by WhatsApp or SMS; its last
-- line is a private link (/t/<link_token>). Opening it marks the task seen; one button records
-- "started" and one "finished", with the server's time. The link names one task only.

alter table public.tasks
  add column link_token text unique
  default translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/', '-_');

-- Who acts in tasks_guard: the signed-in person, or the task's technician when the action comes
-- through the task link (set by task_link_* below for the current transaction only).
create or replace function public.tasks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  acting uuid := nullif(current_setting('m2.acting_employee', true), '')::uuid;
  me uuid := coalesce(acting, public.current_employee_id());
  mgr boolean := acting is null and public.is_manager();
  t timestamptz;
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(me, new.created_by);
    new.status := 'new';
    new.sent_at := null; new.seen_at := null; new.started_at := null;
    new.completed_at := null; new.cancelled_at := null;
    return new;
  end if;

  if not mgr then
    if me is null or old.assignee_id is distinct from me then
      raise exception 'This task is not assigned to you';
    end if;
    if (new.task_type_id, new.assignee_id, new.details, new.subscriber_name, new.subscriber_phone,
        new.zone_id, new.location_text, new.priority, new.expected_minutes, new.created_by, new.cancel_reason, new.link_token)
       is distinct from
       (old.task_type_id, old.assignee_id, old.details, old.subscriber_name, old.subscriber_phone,
        old.zone_id, old.location_text, old.priority, old.expected_minutes, old.created_by, old.cancel_reason, old.link_token) then
      raise exception 'A technician can only start, finish and add notes to a task';
    end if;
    if new.status is distinct from old.status and not (
         (old.status in ('new', 'sent') and new.status = 'seen')
      or (old.status in ('new', 'sent', 'seen') and new.status = 'in_progress')
      or (old.status = 'in_progress' and new.status = 'done')) then
      raise exception 'Invalid task step';
    end if;
  else
    if new.assignee_id is distinct from old.assignee_id then
      if old.status not in ('new', 'sent', 'seen') then
        raise exception 'A started or closed task cannot be reassigned';
      end if;
      new.status := 'new';
      new.sent_at := null; new.seen_at := null;
      insert into public.task_events (task_id, event, actor_id, meta)
        values (new.id, 'reassigned', me, jsonb_build_object('from', old.assignee_id, 'to', new.assignee_id));
    elsif new.status is distinct from old.status and not (
         (old.status = 'new' and new.status = 'sent')
      or (old.status in ('new', 'sent', 'seen', 'in_progress') and new.status = 'cancelled')) then
      raise exception 'The manager can send or cancel a task; the technician starts and finishes it';
    end if;
  end if;

  -- Server-owned times: copied from the old row unless this update is the step that sets them.
  new.sent_at := coalesce(new.sent_at, old.sent_at);
  if new.assignee_id is not distinct from old.assignee_id then
    new.sent_at := old.sent_at; new.seen_at := old.seen_at;
  end if;
  new.started_at := old.started_at; new.completed_at := old.completed_at; new.cancelled_at := old.cancelled_at;

  if new.status is distinct from old.status then
    t := public.event_time(new.recorded_offline, new.device_time, coalesce(old.started_at, old.sent_at, old.created_at));
    case new.status
      when 'sent' then
        new.sent_at := now();
      when 'seen' then
        new.seen_at := t;
        insert into public.task_events (task_id, event, actor_id, at, recorded_offline) values (new.id, 'seen', me, t, new.recorded_offline);
      when 'in_progress' then
        new.seen_at := coalesce(new.seen_at, t);
        new.started_at := t;
        insert into public.task_events (task_id, event, actor_id, at, recorded_offline) values (new.id, 'started', me, t, new.recorded_offline);
      when 'done' then
        new.completed_at := greatest(t, new.started_at);
        insert into public.task_events (task_id, event, actor_id, at, recorded_offline) values (new.id, 'completed', me, new.completed_at, new.recorded_offline);
      when 'cancelled' then
        if length(btrim(coalesce(new.cancel_reason, ''))) = 0 then
          raise exception 'Cancelling a task needs a reason';
        end if;
        new.cancelled_at := now();
        insert into public.task_events (task_id, event, actor_id) values (new.id, 'cancelled', me);
      else
        null;
    end case;
  end if;
  return new;
end $$;

-- What the technician sees behind the link. The first open marks the task "seen".
create function public.task_link_view(p_token text) returns jsonb
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
    'completion_notes', t.completion_notes
  );
end $$;

-- The two buttons behind the link: 'start' and 'done' (with an optional note for the manager).
-- Pressing "done" without "start" closes the task in one go. Pressing twice changes nothing.
create function public.task_link_act(p_token text, p_action text, p_notes text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.tasks;
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
  end if;
  perform set_config('m2.acting_employee', '', true);
  return public.task_link_view(p_token);
end $$;

revoke execute on function public.task_link_view(text) from public;
revoke execute on function public.task_link_act(text, text, text) from public;
grant execute on function public.task_link_view(text) to anon, authenticated;
grant execute on function public.task_link_act(text, text, text) to anon, authenticated;

-- Tell the Data API about the new functions right away.
notify pgrst, 'reload schema';

-- ===================== 20261030000006_attendance_qr.sql =====================

-- =====================================================================
--  نظام مخيم 2: الحضور بتصوير ورقة الـ QR (بدون تطبيق وبدون دخول)
--  لمشروع شُغّل عليه setup.sql من قبل: الصق هذا الملف في SQL Editor ثم Run، مرة واحدة.
-- =====================================================================
-- The office has one printed QR sheet: https://<app>/a/<point code>. A person scans it with the
-- phone camera. The first time on a phone they pick their name and type the 4-digit attendance
-- code the admin gave them; the phone then keeps a private device key. From then on every scan
-- records "in" or "out" at once, on the server's clock: the first scan of the day is "in", the
-- next "out", and so on. Reprinting the sheet (a new point code) makes the old one useless.

-- Attendance codes: kept out of the employees table, readable by no one (only the functions below).
create table public.attendance_codes (
  employee_id uuid primary key references public.employees (id) on delete cascade,
  code_hash text not null,
  failures smallint not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.attendance_codes enable row level security;
revoke all on public.attendance_codes from anon, authenticated;

-- Phones that may record attendance, one person each. The manager sees and can switch them off.
create table public.attendance_devices (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  token_hash text not null unique,
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index attendance_devices_employee on public.attendance_devices (employee_id);
alter table public.attendance_devices enable row level security;
create policy attendance_devices_read on public.attendance_devices for select to authenticated using (public.is_manager());
create policy attendance_devices_revoke on public.attendance_devices for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
grant select, update on public.attendance_devices to authenticated;
create trigger attendance_devices_audit after update or delete on public.attendance_devices
  for each row execute function public.audit_row();

-- Who is expected in the office and on which hours (full day or بطالة), and their 4-digit code.
-- p_code null keeps the current code.
create function public.admin_set_attendance(p_employee_id uuid, p_schedule_id smallint, p_code text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.has_role('admin') then raise exception 'not_allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.employees where id = p_employee_id) then raise exception 'missing'; end if;
  if p_schedule_id is not null then
    update public.employees set schedule_id = p_schedule_id where id = p_employee_id;
  end if;
  if p_code is not null then
    if p_code !~ '^[0-9]{4}$' then raise exception 'bad_code'; end if;
    insert into public.attendance_codes (employee_id, code_hash)
      values (p_employee_id, crypt(p_code, gen_salt('bf', 8)))
      on conflict (employee_id) do update
        set code_hash = excluded.code_hash, failures = 0, locked_until = null, updated_at = now();
  end if;
end $$;

-- For the settings screen: who already has an attendance code.
create function public.attendance_code_holders() returns setof uuid
language sql stable security definer set search_path = public as $$
  select employee_id from public.attendance_codes where public.is_manager()
$$;

create function public.attendance_point_id(p_point text) returns smallint
language sql stable security definer set search_path = public as $$
  select id from public.attendance_points where code = p_point and is_active and revoked_at is null
$$;

-- The names to choose from the first time a phone scans the sheet.
create function public.attendance_people(p_point text) returns table (id uuid, name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.attendance_point_id(p_point) is null then raise exception 'bad_point'; end if;
  return query
    select e.id, e.full_name from public.employees e
    where e.is_active and e.tracks_attendance
    order by e.full_name;
end $$;

-- First scan on a phone: name + code -> a private device key, kept on that phone.
-- Five wrong codes lock that person's code for 15 minutes.
create function public.attendance_register(p_point text, p_employee_id uuid, p_code text, p_label text default null) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  c public.attendance_codes;
  v_token text;
begin
  if public.attendance_point_id(p_point) is null then raise exception 'bad_point'; end if;
  if not exists (select 1 from public.employees where id = p_employee_id and is_active and tracks_attendance) then
    raise exception 'not_tracked';
  end if;
  select * into c from public.attendance_codes where employee_id = p_employee_id for update;
  if not found then raise exception 'no_code'; end if;
  if c.locked_until is not null and c.locked_until > now() then raise exception 'locked'; end if;
  if crypt(coalesce(p_code, ''), c.code_hash) <> c.code_hash then
    update public.attendance_codes set
      failures = case when c.failures >= 4 then 0 else c.failures + 1 end,
      locked_until = case when c.failures >= 4 then now() + interval '15 minutes' else null end
    where employee_id = p_employee_id;
    return null;
  end if;
  update public.attendance_codes set failures = 0, locked_until = null where employee_id = p_employee_id;
  v_token := encode(gen_random_bytes(24), 'hex');
  insert into public.attendance_devices (employee_id, token_hash, label)
    values (p_employee_id, encode(digest(v_token, 'sha256'), 'hex'), left(p_label, 120));
  return v_token;
end $$;

-- Every later scan: records in/out for the phone's owner and returns today's record.
-- A second scan within two minutes records nothing new (a double tap or a shaky camera).
create function public.attendance_punch(p_point text, p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_point smallint := public.attendance_point_id(p_point);
  d public.attendance_devices;
  e public.employees;
  v_last public.attendance_punches;
  v_kind public.punch_kind;
  v_day_start timestamptz := (date_trunc('day', now() at time zone 'Asia/Gaza')) at time zone 'Asia/Gaza';
  v_repeat boolean := false;
begin
  if v_point is null then raise exception 'bad_point'; end if;
  select * into d from public.attendance_devices
    where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and revoked_at is null;
  if not found then raise exception 'unknown_device'; end if;
  select * into e from public.employees where id = d.employee_id;
  if not (e.is_active and e.tracks_attendance) then raise exception 'not_tracked'; end if;

  perform pg_advisory_xact_lock(hashtext(e.id::text));
  select * into v_last from public.attendance_punches
    where employee_id = e.id and at >= v_day_start order by at desc limit 1;
  if found and v_last.at > now() - interval '2 minutes' then
    v_repeat := true;
  else
    v_kind := case when found and v_last.kind = 'in' then 'out' else 'in' end;
    insert into public.attendance_punches (employee_id, kind, at, method, point_id)
      values (e.id, v_kind, now(), 'qr', v_point);
  end if;
  update public.attendance_devices set last_used_at = now() where id = d.id;

  return jsonb_build_object(
    'name', e.full_name,
    'repeat', v_repeat,
    'punches', coalesce((
      select jsonb_agg(jsonb_build_object('kind', p.kind, 'at', p.at) order by p.at)
      from public.attendance_punches p where p.employee_id = e.id and p.at >= v_day_start), '[]'::jsonb)
  );
end $$;

revoke execute on function public.admin_set_attendance(uuid, smallint, text) from public, anon;
revoke execute on function public.attendance_code_holders() from public, anon;
revoke execute on function public.attendance_point_id(text) from public, anon, authenticated;
revoke execute on function public.attendance_people(text) from public;
revoke execute on function public.attendance_register(text, uuid, text, text) from public;
revoke execute on function public.attendance_punch(text, text) from public;
grant execute on function public.admin_set_attendance(uuid, smallint, text) to authenticated;
grant execute on function public.attendance_code_holders() to authenticated;
grant execute on function public.attendance_people(text) to anon, authenticated;
grant execute on function public.attendance_register(text, uuid, text, text) to anon, authenticated;
grant execute on function public.attendance_punch(text, text) to anon, authenticated;

-- Tell the Data API about the new tables and functions right away.
notify pgrst, 'reload schema';
