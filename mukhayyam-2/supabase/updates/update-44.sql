-- تحديث 44: خيارات الحضور وتعبئة يدوية للأسبوع.
-- Optional office-network restriction and explicit attendance links; no automatic backfill.
alter table public.attendance_points add column if not exists network_required boolean not null default true;
alter table public.attendance_points add column if not exists free_punch boolean not null default false;
create or replace function public.attendance_options_set(p_point smallint,p_network boolean,p_free boolean) returns void
language plpgsql security definer set search_path=public as $$ begin
 if not public.is_manager() then raise exception 'not_allowed' using errcode='42501';end if;
 update public.attendance_points set network_required=coalesce(p_network,true),free_punch=coalesce(p_free,false) where id=p_point;
 if not found then raise exception 'bad_point';end if;
end $$;
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
    if pt.network_required and cardinality(pt.allowed_ips) > 0 and not (coalesce(public.client_ip(), '') = any (pt.allowed_ips)) then
      raise exception 'wrong_network';
    end if;
    -- And from the office place, when the manager has set where it is (the phone's own accuracy counts, up to 50 m).
    if pt.lat is not null and not pt.free_punch then
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
    where employee_id = e.id and at >= v_day_start and (pt.free_punch or method = 'qr');

  if found and v_last.kind = 'in' then v_kind := 'out'; else v_kind := 'in'; end if;
  if v_scans >= 2 then
    v_status := 'full';
  elsif not pt.free_punch and v_last.at is not null and v_last.at > now() - interval '2 minutes' then
    v_status := 'repeat';
  elsif not pt.free_punch and v_kind = 'out' and v_last.at > now() - v_stay then
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

-- Explicit kind makes double clicks safe: the same action cannot become the opposite punch.
drop function if exists public.attendance_button_punch(text,text,text);
create or replace function public.attendance_button_punch(p_point text,p_token text,p_kind text,p_lat double precision default null,p_lng double precision default null,p_acc double precision default null) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare who uuid;state jsonb;begin
 if p_kind not in ('in','out') or p_kind is null then raise exception 'bad_kind';end if;
 select employee_id into who from attendance_devices where token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex') and revoked_at is null;
 if who is null then raise exception 'unknown_device';end if;
 perform pg_advisory_xact_lock(hashtext(who::text));
 state:=public.attendance_punch(p_point,p_token,null,null,null,true);
 if state->>'next'<>p_kind or state->>'status'='full' then return state;end if;
 return public.attendance_punch(p_point,p_token,p_lat,p_lng,p_acc,false);
end $$;
-- Manager-entered estimates retain an explicit reason and actor; existing records are never overwritten.
create or replace function public.attendance_fill_week(p_start date,p_employees uuid[]) returns integer
language plpgsql security definer set search_path=public as $$
declare emp record;day date;v_kind public.punch_kind;at_time timestamptz;total integer:=0;v_today date:=(now() at time zone 'Asia/Gaza')::date;
begin
 if not public.is_manager() then raise exception 'not_allowed' using errcode='42501';end if;
 if p_start is null or p_start>v_today or cardinality(p_employees)>500 then raise exception 'bad_range';end if;
 for emp in select e.id,coalesce(w.work_days,array[6,0,1,2,3,4]::smallint[]) work_days from employees e left join work_schedules w on w.id=e.schedule_id where e.id=any(p_employees) and e.is_active and e.deleted_at is null and e.tracks_attendance order by e.id loop
  perform pg_advisory_xact_lock(hashtext(emp.id::text));
  for day in select x::date from generate_series(p_start::timestamp,least(p_start+6,v_today)::timestamp,interval '1 day') x loop
   if extract(dow from day)=5 or not (extract(dow from day)::smallint=any(emp.work_days)) or exists(select 1 from holidays where holiday_date=day) or exists(select 1 from leaves where employee_id=emp.id and day between from_date and to_date) then continue;end if;
   foreach v_kind in array array['in','out']::public.punch_kind[] loop
    if exists(select 1 from attendance_punches where employee_id=emp.id and (at at time zone 'Asia/Gaza')::date=day and attendance_punches.kind=v_kind) then continue;end if;
    at_time:=(day+case when v_kind='in' then time '07:30'+make_interval(mins=>floor(random()*61)::int) else time '16:00'+make_interval(mins=>floor(random()*61)::int) end) at time zone 'Asia/Gaza';
    if at_time>now() then continue;end if;
    if v_kind='out' and not exists(select 1 from attendance_punches where employee_id=emp.id and (at at time zone 'Asia/Gaza')::date=day and attendance_punches.kind='in' and at<at_time) then continue;end if;
    insert into attendance_punches(employee_id,kind,at,method,recorded_by,reason) values(emp.id,v_kind,at_time,'manual',public.current_employee_id(),'تعبئة أسبوعية تقديرية باعتماد المدير');total:=total+1;
   end loop;
  end loop;
 end loop;
 return total;
end $$;
revoke all on function public.attendance_options_set(smallint,boolean,boolean),public.attendance_fill_week(date,uuid[]) from public,anon;
grant execute on function public.attendance_options_set(smallint,boolean,boolean),public.attendance_fill_week(date,uuid[]) to authenticated;
revoke all on function public.attendance_button_punch(text,text,text,double precision,double precision,double precision) from public;
grant execute on function public.attendance_button_punch(text,text,text,double precision,double precision,double precision) to anon,authenticated;
notify pgrst,'reload schema';
