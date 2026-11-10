-- =====================================================================
--  نظام مخيم 2: التحديث 20 · الحضور بالـQR: موقع المكتب، مرتين باليوم، ومدة قبل الانصراف
--  الصق هذا الملف كاملاً في Supabase > SQL Editor ثم اضغط Run (تكراره لا يضر).
--  النتيجة المتوقعة: Success. No rows returned
-- =====================================================================

alter table public.attendance_points add column if not exists lat double precision;
alter table public.attendance_points add column if not exists lng double precision;
alter table public.attendance_points add column if not exists radius_m integer not null default 100;
alter table public.attendance_points drop constraint if exists attendance_points_place_ok;
alter table public.attendance_points add constraint attendance_points_place_ok
  check ((lat is null and lng is null) or (lat between -90 and 90 and lng between -180 and 180 and radius_m between 20 and 1000));

-- Metres between two points on the earth (haversine).
create or replace function public.distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision) returns double precision
language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ))
$$;

drop function if exists public.attendance_punch(text, text);
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

  -- Only from the office, when the manager has set where it is. The phone's own accuracy is allowed for (up to 50 m).
  if not p_peek and pt.lat is not null then
    if p_lat is null or p_lng is null then raise exception 'need_location'; end if;
    v_dist := public.distance_m(pt.lat, pt.lng, p_lat, p_lng);
    if v_dist - least(greatest(coalesce(p_acc, 0), 0), 50) > pt.radius_m then
      raise exception 'too_far:%', round(v_dist);
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
revoke execute on function public.distance_m(double precision, double precision, double precision, double precision) from public;
grant execute on function public.distance_m(double precision, double precision, double precision, double precision) to anon, authenticated;

notify pgrst, 'reload schema';
