-- =====================================================================
--  نظام مخيم 2: التحديث 7 · المسميات الوظيفية والواتساب والفريق
--  الصق هذا الملف كاملاً في Supabase > SQL Editor ثم اضغط Run.
--  يشمل التحديث 6، فلا داعي لتشغيله وحده. النتيجة المتوقعة: Success. No rows returned
-- =====================================================================

do $$
begin
  if to_regclass('public.stock_items') is null then
    raise exception 'شغّل update-4.sql أولاً (run update-4.sql first)';
  end if;
end $$;


-- ===================== 20261030000008_manager_settings.sql =====================

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

-- ===================== 20261030000009_site_generators_live.sql =====================

-- =====================================================================
--  نظام مخيم 2: موظف الموقع يضيف المولدات ويعدّلها بنفسه + تحديث فوري للمدير
-- =====================================================================
-- 1. The site employee adds a generator, or changes its settings (name, brand, kVA, litres per
--    hour), straight from the day's report. Managers can do the same from the settings.
-- 2. The two daily sheets are announced on Realtime, so the manager's screen updates the moment
--    the site types something (when Realtime is available on the project).

create or replace function public.save_generator(
  p_id smallint,
  p_name text,
  p_brand text,
  p_model text,
  p_capacity_kva numeric,
  p_liters_per_hour numeric,
  p_is_active boolean
) returns smallint
language plpgsql security definer set search_path = public as $$
declare
  v_id smallint;
  v_name text := btrim(coalesce(p_name, ''));
  v_brand text := btrim(coalesce(p_brand, ''));
begin
  if not (public.is_manager() or public.is_site_staff()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if length(v_name) not between 1 and 60 then raise exception 'bad_name'; end if;
  if length(v_brand) > 60 then raise exception 'bad_name'; end if;

  if p_id is null then
    insert into public.generators (name, brand, model, capacity_kva, liters_per_hour, is_active, sort_order)
    values (v_name, v_brand, nullif(btrim(coalesce(p_model, '')), ''), p_capacity_kva, p_liters_per_hour, coalesce(p_is_active, true),
            coalesce((select max(sort_order) from public.generators), 0) + 1)
    returning id into v_id;
  else
    update public.generators set
      name = v_name, brand = v_brand, model = nullif(btrim(coalesce(p_model, '')), ''),
      capacity_kva = p_capacity_kva, liters_per_hour = p_liters_per_hour, is_active = coalesce(p_is_active, true)
    where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'missing'; end if;
  end if;
  return v_id;
end $$;

revoke execute on function public.save_generator(smallint, text, text, text, numeric, numeric, boolean) from anon, public;
grant execute on function public.save_generator(smallint, text, text, text, numeric, numeric, boolean) to authenticated;

-- Realtime for the daily sheets (skipped quietly where Realtime is not installed).
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['site_reports', 'distribution_sheets'] loop
      if not exists (
        select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

notify pgrst, 'reload schema';

-- ===================== 20261030000010_job_titles_whatsapp.sql =====================

-- =====================================================================
--  نظام مخيم 2: المسمى الوظيفي + مقدمة الواتساب لكل موظف
-- =====================================================================
-- job_title: what the person does in the office (نائب المدير، محاسبة، فني...), shown instead of the
--            system role where it is set.
-- wa_code:   the country code their WhatsApp was registered with. Palestinian numbers are on
--            WhatsApp as +972 or +970, and a wa.me link only opens with the right one.

alter table public.employees add column if not exists job_title text check (job_title is null or length(job_title) <= 60);
alter table public.employees add column if not exists wa_code smallint not null default 972 check (wa_code in (970, 972));

create or replace function public.admin_set_profile(p_id uuid, p_job_title text, p_wa_code smallint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.employees
     set job_title = nullif(btrim(coalesce(p_job_title, '')), ''),
         wa_code = coalesce(p_wa_code, wa_code)
   where id = p_id;
  if not found then raise exception 'missing'; end if;
end $$;

revoke execute on function public.admin_set_profile(uuid, text, smallint) from anon, public;
grant execute on function public.admin_set_profile(uuid, text, smallint) to authenticated;

notify pgrst, 'reload schema';

-- ===================== الفريق (قائمة 31 أكتوبر 2026) =====================
-- Adds the office team with their job titles and phones. People already in the system under a
-- shorter name (قصي الشافعي = قصي كمال الشافعي ...) are updated, never added twice, so their tasks
-- and attendance stay with them. Technicians and staff not on the list are switched off (kept for
-- history, not deleted). The manager and the deputy get full rights (system admin role).
-- Everyone on the list records attendance; the first-scan code is 0000 for all.
do $$
declare
  p record;
  v_id uuid;
  v_phone text;
  v_has_login boolean;
  v_schedule smallint := (select id from public.work_schedules where name = 'دوام كامل' order by id limit 1);
  v_kept uuid[] := '{}';
  norm text;
begin
  for p in
    select * from (values
      (1,  'رامي أبو عجوة',          array['رامي أبو عجوة'],               'المدير',            'admin',      null),
      (2,  'محمد كمال الشافعي',      array['محمد الشافعي'],                'نائب المدير',       'admin',      '0597284148'),
      (3,  'مهند فتحي دويدار',       array['مهند دويدار'],                 'مدير الفنيين',      'technician', '0593399744'),
      (4,  'أحمد سعيد طعيمة',        array['أحمد طعيمة', 'احمد طعيمه'],   'فني',               'technician', '0599064210'),
      (5,  'قصي كمال الشافعي',       array['قصي الشافعي'],                 'فني',               'technician', '0592398242'),
      (6,  'بشار محمد خطاب',         array['بشار خطاب'],                   'فني',               'technician', '0598367159'),
      (7,  'بشار وائل الشافعي',      array['بشار الشافعي'],                'فني',               'technician', '0592329159'),
      (8,  'مجد عاشور',              array['مجد عاشور'],                   'فني',               'technician', '0598166638'),
      (9,  'أحمد شعبان أبو عمار',    array['أحمد أبو عمار'],               'محصّل',             'staff',      null),
      (10, 'محمود عبد الغني جبريل',  array['محمود جبريل'],                 'محصّل',             'staff',      '0595871931'),
      (11, 'علياء رزق شلط',          array['علياء شلط'],                   'محاسبة',            'staff',      '0593207166'),
      (12, 'محاسن عزمي أبو زايد',    array['محاسن أبو زايد'],              'محاسبة',            'staff',      '0593065684'),
      (13, 'هشام عادل أبو شنب',      array['هشام أبو شنب'],                'آذن ومراسل الفرع',  'staff',      '0592508373'),
      (14, 'محمد ماهر أبو مزيد',     array['محمد أبو مزيد'],               'مدخل بيانات',       'staff',      null),
      -- Same phone as محمود جبريل on the list: left without a phone until it is corrected.
      (15, 'حسن أبو علي',            array['حسن أبو علي'],                 'محاسب',             'staff',      null),
      (16, 'مصطفى فرحات',            array['مصطفى فرحات'],                 null,                'staff',      '0599245796')
    ) as t(n, full_name, aliases, job_title, role, phone)
    order by n
  loop
    -- Same person = same name once hamza, taa marbuta and spaces are ignored, or the same phone.
    select e.id into v_id
      from public.employees e
     where regexp_replace(translate(e.full_name, 'أإآةىـ', 'اااهي'), '\s+', '', 'g') in (
             select regexp_replace(translate(a, 'أإآةىـ', 'اااهي'), '\s+', '', 'g')
               from unnest(p.aliases || p.full_name) a)
        or (p.phone is not null and e.phone = p.phone)
     order by e.is_active desc, e.created_at
     limit 1;

    -- A phone can belong to one person only; never change the phone behind someone's login.
    v_phone := p.phone;
    if v_phone is not null and exists (select 1 from public.employees where phone = v_phone and id is distinct from v_id) then
      v_phone := null;
    end if;

    if v_id is null then
      insert into public.employees (full_name, role, phone, is_active, tracks_attendance, schedule_id, job_title, wa_code)
      values (p.full_name, p.role::public.user_role, v_phone, true, p.n <> 1, v_schedule, p.job_title, 972)
      returning id into v_id;
    else
      select auth_user_id is not null into v_has_login from public.employees where id = v_id;
      update public.employees set
        full_name = p.full_name,
        role = p.role::public.user_role,
        job_title = p.job_title,
        phone = case when v_has_login or v_phone is null then phone else v_phone end,
        is_active = true,
        tracks_attendance = case when p.n = 1 then tracks_attendance else true end,
        schedule_id = coalesce(schedule_id, v_schedule)
      where id = v_id;
    end if;
    v_kept := v_kept || v_id;

    if p.n <> 1 then
      insert into public.attendance_codes (employee_id, code_hash)
      values (v_id, extensions.crypt('0000', extensions.gen_salt('bf', 8)))
      on conflict (employee_id) do update
        set code_hash = excluded.code_hash, failures = 0, locked_until = null, updated_at = now();
    end if;
  end loop;

  -- Old technicians and staff not on the list: switched off, history kept.
  update public.employees
     set is_active = false, tracks_attendance = false
   where role in ('technician', 'staff') and is_active and not (id = any (v_kept));
end $$;
