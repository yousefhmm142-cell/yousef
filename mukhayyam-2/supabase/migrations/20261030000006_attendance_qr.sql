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
