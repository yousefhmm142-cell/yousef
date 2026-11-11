-- =====================================================================
--  نظام مخيم 2: الحضور بالـQR بينفتح بس من إنترنت المكتب
-- =====================================================================
-- The manager, sitting on the office Wi-Fi, approves its public address (the one the server sees). A scan
-- that comes from another address (mobile data, home) is refused. Several addresses are allowed (a second
-- line). People marked «يسجّل من أي مكان» (field staff) skip the network and place checks.

alter table public.attendance_points add column if not exists allowed_ips text[] not null default '{}';
alter table public.attendance_points drop constraint if exists attendance_points_ips_few;
alter table public.attendance_points add constraint attendance_points_ips_few check (cardinality(allowed_ips) <= 5);
alter table public.employees add column if not exists punch_anywhere boolean not null default false;

-- The caller's public address, as the edge in front of the database reports it: Cloudflare's own
-- header first (a client cannot set it), then the proxy's.
create or replace function public.client_ip() returns text
language plpgsql stable set search_path = public as $$
declare
  h json;
  v text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    return null;
  end;
  if h is null then return null; end if;
  v := coalesce(nullif(btrim(h ->> 'cf-connecting-ip'), ''), nullif(btrim(h ->> 'x-real-ip'), ''), nullif(btrim(split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1)), ''));
  return v;
end $$;
revoke execute on function public.client_ip() from public, anon;
grant execute on function public.client_ip() to authenticated;

-- The manager, on the office network, adds the address the server sees to the allowed list.
create or replace function public.attendance_office_network_add(p_point smallint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ip text := public.client_ip();
  cur text[];
begin
  if not public.is_manager() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if v_ip is null then raise exception 'no_ip'; end if;
  select allowed_ips into cur from public.attendance_points where id = p_point;
  if not found then raise exception 'bad_point'; end if;
  if not (v_ip = any (cur)) then
    if cardinality(cur) >= 5 then raise exception 'too_many'; end if;
    update public.attendance_points set allowed_ips = array_append(cur, v_ip) where id = p_point;
  end if;
  return jsonb_build_object('ip', v_ip, 'ips', (select allowed_ips from public.attendance_points where id = p_point));
end $$;

-- What the server sees of the caller now (to check before approving).
create or replace function public.attendance_my_ip() returns text
language sql stable security definer set search_path = public as $$
  select case when public.is_manager() then public.client_ip() end
$$;

-- Field staff: allowed to scan from anywhere.
create or replace function public.admin_set_punch_anywhere(p_id uuid, p_value boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.employees set punch_anywhere = coalesce(p_value, false) where id = p_id;
  if not found then raise exception 'missing'; end if;
end $$;

revoke execute on function public.attendance_office_network_add(smallint), public.attendance_my_ip(), public.admin_set_punch_anywhere(uuid, boolean) from public, anon;
grant execute on function public.attendance_office_network_add(smallint), public.attendance_my_ip(), public.admin_set_punch_anywhere(uuid, boolean) to authenticated;

-- The scan: the network (and the place) are checked unless this person may scan from anywhere.
create or replace function public.attendance_punch(
  p_point text, p_token text,
  p_lat double precision default null, p_lng double precision default null, p_acc double precision default null,
  p_peek boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_point smallint := public.attendance_point_id(p_point);
  pt public.attendance_points;
  d public.attendance_devices;
  e public.employees;
  v_last public.attendance_punches;
  v_kind public.punch_kind;
  v_day_start timestamptz := (date_trunc('day', now() at time zone 'Asia/Gaza')) at time zone 'Asia/Gaza';
  v_stay constant interval := interval '60 minutes';
  v_dist double precision;
  v_scans integer;
  v_status text := 'recorded';
  v_wait timestamptz;
begin
  if v_point is null then raise exception 'bad_point'; end if;
  select * into pt from public.attendance_points where id = v_point;
  select * into d from public.attendance_devices
    where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and revoked_at is null;
  if not found then raise exception 'unknown_device'; end if;
  select * into e from public.employees where id = d.employee_id;
  if not (e.is_active and e.tracks_attendance) then raise exception 'not_tracked'; end if;

  if not p_peek and not e.punch_anywhere then
    -- Only from the office network, once the manager approved it.
    if cardinality(pt.allowed_ips) > 0 and not (coalesce(public.client_ip(), '') = any (pt.allowed_ips)) then
      raise exception 'wrong_network';
    end if;
    -- And from the office place, when the manager has set where it is (the phone's own accuracy counts, up to 50 m).
    if pt.lat is not null then
      if p_lat is null or p_lng is null then raise exception 'need_location'; end if;
      v_dist := public.distance_m(pt.lat, pt.lng, p_lat, p_lng);
      if v_dist - least(greatest(coalesce(p_acc, 0), 0), 50) > pt.radius_m then
        raise exception 'too_far:%', round(v_dist);
      end if;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext(e.id::text));
  select * into v_last from public.attendance_punches
    where employee_id = e.id and at >= v_day_start order by at desc limit 1;
  select count(*) into v_scans from public.attendance_punches
    where employee_id = e.id and at >= v_day_start and method = 'qr';

  if found and v_last.kind = 'in' then v_kind := 'out'; else v_kind := 'in'; end if;
  if v_scans >= 2 then
    v_status := 'full';
  elsif v_last.at is not null and v_last.at > now() - interval '2 minutes' then
    v_status := 'repeat';
  elsif v_kind = 'out' and v_last.at > now() - v_stay then
    v_status := 'wait';
    v_wait := v_last.at + v_stay;
  end if;

  if v_status = 'recorded' and not p_peek then
    insert into public.attendance_punches (employee_id, kind, at, method, point_id)
      values (e.id, v_kind, now(), 'qr', v_point);
  elsif v_status = 'recorded' then
    v_status := 'ready';
  end if;
  if not p_peek then update public.attendance_devices set last_used_at = now() where id = d.id; end if;

  return jsonb_build_object(
    'name', e.full_name,
    'repeat', v_status = 'repeat',
    'status', v_status,
    'next', v_kind,
    'wait_until', v_wait,
    'punches', coalesce((
      select jsonb_agg(jsonb_build_object('kind', p.kind, 'at', p.at) order by p.at)
      from public.attendance_punches p where p.employee_id = e.id and p.at >= v_day_start), '[]'::jsonb)
  );
end $$;

revoke execute on function public.attendance_punch(text, text, double precision, double precision, double precision, boolean) from public;
grant execute on function public.attendance_punch(text, text, double precision, double precision, double precision, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
