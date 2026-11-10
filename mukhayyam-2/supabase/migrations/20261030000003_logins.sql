-- Mukhayyam 2: sign-in accounts managed from inside the app, and the very first setup.
-- A login is the employee's phone and a 6-digit PIN. Supabase signs people in by email, so each
-- phone maps to <phone>@m2.local (never a real mailbox). The admin creates and resets logins from
-- the settings screen; nobody needs the Supabase dashboard for that.

-- The app reaches tables through the Supabase Data API as "authenticated"; row level security
-- (20261030000002_security.sql) decides row by row. Granted here explicitly so it does not depend
-- on the project's default settings.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ---------- The sign-in account behind one phone (internal) ----------
-- Creates the account, or updates the phone and PIN of an existing one. p_pin null keeps the PIN.
-- Changing the PIN signs that person out on every device.
create function public.save_login_account(p_user_id uuid, p_phone text, p_pin text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_email text := p_phone || '@m2.local';
  v_uid uuid := p_user_id;
  v_holder uuid;
begin
  if v_uid is not null and not exists (select 1 from auth.users where id = v_uid) then
    v_uid := null;
  end if;

  -- An account already using this phone: reuse it if nobody owns it (left by an earlier employee).
  select id into v_holder from auth.users where email = v_email;
  if v_holder is not null and v_holder is distinct from v_uid then
    if exists (select 1 from public.employees where auth_user_id = v_holder) then
      raise exception 'phone_taken';
    end if;
    -- The person's previous account (old phone) is simply left unused: no employee points to it,
    -- so it opens nothing.
    v_uid := v_holder;
    if p_pin is null then
      raise exception 'pin_needed';
    end if;
  end if;

  if v_uid is null then
    if p_pin is null then
      raise exception 'pin_needed';
    end if;
    v_uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
      crypt(p_pin, gen_salt('bf', 10)), now(),
      '{"provider": "email", "providers": ["email"]}', '{}', now(), now(),
      '', '', '', ''
    );
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      v_uid::text, v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
      'email', now(), now(), now()
    );
  else
    update auth.users set
      email = v_email,
      encrypted_password = case when p_pin is null then encrypted_password else crypt(p_pin, gen_salt('bf', 10)) end,
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      banned_until = null,
      updated_at = now()
    where id = v_uid;
    update auth.identities set
      identity_data = identity_data || jsonb_build_object('email', v_email),
      updated_at = now()
    where user_id = v_uid and provider = 'email';
    if p_pin is not null then
      delete from auth.sessions where user_id = v_uid;
    end if;
  end if;
  return v_uid;
end $$;

-- ---------- Adding and editing people (admin) ----------
-- One call saves the person and their login. p_id null adds a new person. p_pin null keeps the PIN;
-- a person with a phone but no PIN yet has no login. Errors come back as short codes the app shows
-- in Arabic: bad_name, bad_phone, bad_pin, phone_taken, pin_needed, missing, last_admin, not_allowed.
create function public.admin_save_employee(
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
  if not public.has_role('admin') then
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

-- The system can never be left without an admin who can sign in.
create function public.employees_keep_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from old_rows where role = 'admin' and is_active and auth_user_id is not null)
     and not exists (select 1 from public.employees where role = 'admin' and is_active and auth_user_id is not null) then
    raise exception 'last_admin';
  end if;
  return null;
end $$;

create trigger employees_keep_admin_update after update on public.employees
  referencing old table as old_rows for each statement execute function public.employees_keep_admin();
create trigger employees_keep_admin_delete after delete on public.employees
  referencing old table as old_rows for each statement execute function public.employees_keep_admin();

-- ---------- First run ----------
-- True until the first admin has a login. The app then shows "set up the system" instead of sign-in.
create function public.setup_needed() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.employees where role = 'admin' and auth_user_id is not null)
$$;

-- Creates the first admin and their login. Works once only: refused as soon as an admin exists.
create function public.setup_first_admin(p_full_name text, p_phone text, p_pin text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p_full_name, ''));
begin
  lock table public.employees in share row exclusive mode;
  if not public.setup_needed() then raise exception 'already_set_up'; end if;
  if length(v_name) not between 2 and 80 then raise exception 'bad_name'; end if;
  if coalesce(p_phone, '') !~ '^05[0-9]{8}$' then raise exception 'bad_phone'; end if;
  if coalesce(p_pin, '') !~ '^[0-9]{6}$' then raise exception 'bad_pin'; end if;
  if exists (select 1 from public.employees where phone = p_phone) then raise exception 'phone_taken'; end if;

  insert into public.employees (full_name, role, phone, tracks_attendance, schedule_id)
  values (v_name, 'admin', p_phone, false, (select id from public.work_schedules order by id limit 1))
  returning id into v_id;
  update public.employees set auth_user_id = public.save_login_account(null, p_phone, p_pin) where id = v_id;
end $$;

-- ---------- Who may call what ----------
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.save_login_account(uuid, text, text) from authenticated;
grant execute on function public.setup_needed() to anon;
grant execute on function public.setup_first_admin(text, text, text) to anon;
