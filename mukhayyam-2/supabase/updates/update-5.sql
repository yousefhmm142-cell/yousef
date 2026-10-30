-- =====================================================================
--  نظام مخيم 2: الإعدادات كاملة للمدير أيضاً (الموظفون والرموز والدوامات)
--  لمشروع شُغّل عليه setup.sql من قبل: الصق هذا الملف في SQL Editor ثم Run، مرة واحدة.
-- =====================================================================
-- The manager runs the whole settings screen like the admin: people, their logins and PINs,
-- attendance hours and codes. The system can still never lose its last admin.

alter policy employees_admin on public.employees
  using (public.is_manager()) with check (public.is_manager());

create or replace function public.admin_save_employee(
  p_id uuid,
  p_full_name text,
  p_role public.user_role,
  p_phone text,
  p_pin text,
  p_is_active boolean,
  p_tracks_attendance boolean
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id;
  v_user uuid;
  v_name text := btrim(coalesce(p_full_name, ''));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_pin text := nullif(btrim(coalesce(p_pin, '')), '');
begin
  if not public.is_manager() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if length(v_name) not between 2 and 80 then raise exception 'bad_name'; end if;
  if v_phone is not null and v_phone !~ '^05[0-9]{8}$' then raise exception 'bad_phone'; end if;
  if v_pin is not null and v_pin !~ '^[0-9]{6}$' then raise exception 'bad_pin'; end if;
  if v_pin is not null and v_phone is null then raise exception 'bad_phone'; end if;
  if v_phone is not null and exists (select 1 from public.employees where phone = v_phone and id is distinct from v_id) then
    raise exception 'phone_taken';
  end if;

  if v_id is null then
    insert into public.employees (full_name, role, phone, is_active, tracks_attendance, schedule_id)
    values (v_name, p_role, v_phone, p_is_active, p_tracks_attendance,
            (select id from public.work_schedules order by id limit 1))
    returning id into v_id;
  else
    update public.employees set
      full_name = v_name, role = p_role, phone = v_phone,
      is_active = p_is_active, tracks_attendance = p_tracks_attendance
    where id = v_id
    returning auth_user_id into v_user;
    if not found then raise exception 'missing'; end if;
  end if;

  if v_phone is null then
    -- No phone, no login.
    if v_user is not null then
      update public.employees set auth_user_id = null where id = v_id;
      delete from auth.users where id = v_user;
    end if;
  elsif v_pin is not null or v_user is not null then
    v_user := public.save_login_account(v_user, v_phone, v_pin);
    update public.employees set auth_user_id = v_user where id = v_id;
  end if;

  if not p_is_active and v_user is not null then
    delete from auth.sessions where user_id = v_user;
  end if;
  return v_id;
end $$;

create or replace function public.admin_set_attendance(p_employee_id uuid, p_schedule_id smallint, p_code text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_manager() then raise exception 'not_allowed' using errcode = '42501'; end if;
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

-- Tell the Data API right away.
notify pgrst, 'reload schema';
