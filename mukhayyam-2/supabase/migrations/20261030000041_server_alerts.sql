-- =====================================================================
--  نظام مخيم 2: تنبيهات من الخادم برسالة SMS (حتى لو ما حدا فاتح الموقع)
-- =====================================================================
-- Every 30 minutes the database itself looks for what needs the manager and texts the chosen phones from
-- the company's SMS subscription (the same login as Settings › الرسائل):
--   · yesterday's generation report or distribution sheet not sent by the late time (report_late_warn)
--   · tasks past their expected time (each task once)
--   · diesel running out (fewer days left than fuel_days_danger), once per report
--   · the nightly backup not taken for more than a day and a half
-- Each alert goes out once (m2_ops.alerts_sent). Off until the manager turns it on.

alter table public.app_settings add column if not exists alert_sms boolean not null default false;
alter table public.app_settings add column if not exists alert_phones text[] not null default '{}';

create table if not exists m2_ops.alerts_sent (
  kind text not null,
  ref text not null,
  sent_at timestamptz not null default now(),
  primary key (kind, ref)
);

-- What would be sent right now (texts not yet sent), without sending. The check job and the settings
-- preview both use it.
create or replace function m2_ops.alerts_due() returns table (kind text, ref text, body text)
language plpgsql stable security definer set search_path = public as $$
declare
  s public.app_settings;
  now_gaza timestamp := now() at time zone 'Asia/Gaza';
  today date := (now() at time zone 'Asia/Gaza')::date;
  yday date := (now() at time zone 'Asia/Gaza')::date - 1;
  rep record;
  remaining numeric;
  daily numeric;
  late_list text;
  late_refs text[];
  last_backup timestamptz;
begin
  select * into s from public.app_settings limit 1;
  if s is null then return; end if;

  -- 1) Yesterday's papers, once the late time has passed today.
  if now_gaza::time >= s.report_late_warn then
    if not exists (select 1 from public.site_reports r where r.report_date = yday and r.status in ('submitted', 'approved'))
       and not exists (select 1 from m2_ops.alerts_sent a where a.kind = 'late_generation' and a.ref = yday::text) then
      kind := 'late_generation'; ref := yday::text;
      body := 'مخيم 2: تقرير التوليد ليوم ' || to_char(yday, 'DD/MM') || ' ما وصل لهلأ.';
      return next;
    end if;
    if not exists (select 1 from public.distribution_sheets d where d.sheet_date = yday and d.status in ('submitted', 'approved'))
       and not exists (select 1 from m2_ops.alerts_sent a where a.kind = 'late_distribution' and a.ref = yday::text) then
      kind := 'late_distribution'; ref := yday::text;
      body := 'مخيم 2: كشف التوزيع ليوم ' || to_char(yday, 'DD/MM') || ' ما وصل لهلأ.';
      return next;
    end if;
  end if;

  -- 2) Tasks past their time (sent, still open), each one once; one text for all the new ones.
  select string_agg('#' || t.number, '، ' order by t.number), array_agg(t.id::text)
    into late_list, late_refs
    from public.tasks t
   where t.status in ('sent', 'seen', 'in_progress')
     and coalesce(t.sent_at, t.created_at) + make_interval(mins => t.expected_minutes) < now()
     and coalesce(t.sent_at, t.created_at) > now() - interval '3 days'
     and not exists (select 1 from m2_ops.alerts_sent a where a.kind = 'late_task' and a.ref = t.id::text);
  if late_refs is not null then
    kind := 'late_task'; ref := array_to_string(late_refs, ',');
    body := 'مخيم 2: ' || case when cardinality(late_refs) = 1 then 'مهمة تجاوزت وقتها: ' else cardinality(late_refs) || ' مهام تجاوزت وقتها: ' end
            || left(late_list, 120);
    return next;
  end if;

  -- 3) Diesel: the last sent report, at the average daily use of the last seven reports.
  select r.id, r.report_date into rep
    from public.site_reports r where r.status in ('submitted', 'approved') order by r.report_date desc limit 1;
  if rep.id is not null and not exists (select 1 from m2_ops.alerts_sent a where a.kind = 'fuel_low' and a.ref = rep.report_date::text) then
    select sum(f.closing_balance) into remaining from public.site_report_fuel f where f.report_id = rep.id and f.closing_balance is not null;
    select avg(c) into daily from (
      select sum(f.consumption) c from public.site_reports r join public.site_report_fuel f on f.report_id = r.id
       where r.status in ('submitted', 'approved') and r.report_date <= rep.report_date
       group by r.report_date order by r.report_date desc limit 7) x
     where c > 0;
    if remaining is not null and daily > 0 and remaining / daily < s.fuel_days_danger then
      kind := 'fuel_low'; ref := rep.report_date::text;
      body := 'مخيم 2: السولار قرب يخلص. الباقي ' || round(remaining) || ' لتر، بيكفي تقريباً ' || round(remaining / daily, 1) || ' يوم.';
      return next;
    end if;
  end if;

  -- 4) The nightly copy (only once one was ever taken, so a new system does not warn).
  select max(b.taken_at) into last_backup from public.backups b;
  if last_backup is not null and last_backup < now() - interval '36 hours'
     and not exists (select 1 from m2_ops.alerts_sent a where a.kind = 'backup' and a.ref = today::text) then
    kind := 'backup'; ref := today::text;
    body := 'مخيم 2: النسخة الاحتياطية التلقائية ما انعملت من ' || to_char(last_backup at time zone 'Asia/Gaza', 'DD/MM') || '. افحصوها.';
    return next;
  end if;
end $$;
revoke all on function m2_ops.alerts_due() from public;

-- The job: sends what is due to the chosen phones and remembers it. Nothing when it is off.
create or replace function m2_ops.alerts_run() returns integer
language plpgsql security definer set search_path = public as $$
declare
  s public.app_settings;
  cfg m2_ops.sms_config;
  a record;
  ph text;
  code text;
  ok boolean;
  n integer := 0;
begin
  select * into s from public.app_settings limit 1;
  if s is null or not s.alert_sms or cardinality(s.alert_phones) = 0 then return 0; end if;
  select * into cfg from m2_ops.sms_config where id = 1;
  if cfg.user_name is null then return 0; end if;
  for a in select * from m2_ops.alerts_due() loop
    ok := false;
    foreach ph in array s.alert_phones loop
      code := m2_ops.hotsms('sendbulksms.php', jsonb_build_object(
        'sender', coalesce(cfg.sender, 'AF Camp2'), 'mobile', '972' || substr(ph, 2), 'type', '2', 'text', a.body));
      insert into public.outgoing_messages (channel, to_phone, body, status, provider, provider_ref, error, sent_at)
      values ('sms', ph, a.body, case when code like '1001%' then 'sent' else 'failed' end::public.message_status,
              'hotsms', code, case when code like '1001%' then null else code end, case when code like '1001%' then now() end);
      ok := ok or code like '1001%';
    end loop;
    -- Remembered only once it went out, so a failed send is tried again next time.
    if ok then
      insert into m2_ops.alerts_sent (kind, ref)
        select a.kind, r from unnest(case when a.kind = 'late_task' then string_to_array(a.ref, ',') else array[a.ref] end) r
        on conflict do nothing;
      n := n + 1;
    end if;
  end loop;
  delete from m2_ops.alerts_sent where sent_at < now() - interval '30 days';
  return n;
end $$;
revoke all on function m2_ops.alerts_run() from public;

-- Settings › الرسائل: turn on/off and the phones (up to 3).
create or replace function public.alerts_set(p_on boolean, p_phones text[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  phones text[] := array(select distinct btrim(x) from unnest(coalesce(p_phones, '{}')) x where btrim(x) <> '');
begin
  if not public.is_manager() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if cardinality(phones) > 3 then raise exception 'too_many'; end if;
  if exists (select 1 from unnest(phones) x where x !~ '^05[0-9]{8}$') then raise exception 'bad_phone'; end if;
  if p_on and cardinality(phones) = 0 then raise exception 'no_phone'; end if;
  update public.app_settings set alert_sms = p_on, alert_phones = phones where id;
end $$;

-- What the screen shows: on/off, the phones, what would go out now, and whether the nightly jobs run.
create or replace function public.alerts_info() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.app_settings;
  jobs jsonb := '[]'::jsonb;
begin
  if not public.is_manager() then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into s from public.app_settings limit 1;
  -- pg_cron is on Supabase; a bare test database has none.
  if to_regclass('cron.job') is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', j.jobname, 'active', j.active,
               'last_at', d.start_time, 'last_status', d.status, 'last_error', left(d.return_message, 200))), '[]'::jsonb)
        from cron.job j
        left join lateral (select start_time, status, return_message from cron.job_run_details x
                            where x.jobid = j.jobid order by x.start_time desc limit 1) d on true
       where j.jobname like 'm2-%'
    $q$ into jobs;
  end if;
  return jsonb_build_object(
    'on', coalesce(s.alert_sms, false),
    'phones', to_jsonb(coalesce(s.alert_phones, '{}')),
    'due', (select coalesce(jsonb_agg(jsonb_build_object('kind', d.kind, 'body', d.body)), '[]'::jsonb) from m2_ops.alerts_due() d),
    'last_backup', (select max(taken_at) from public.backups),
    'jobs', jobs,
    'cron', to_regclass('cron.job') is not null
  );
end $$;

-- «جرّب»: one test text to the chosen phones.
create or replace function public.alerts_test() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.app_settings;
begin
  if not public.is_manager() then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into s from public.app_settings limit 1;
  if cardinality(s.alert_phones) = 0 then raise exception 'no_phone'; end if;
  return public.sms_send(s.alert_phones, 'مخيم 2: تجربة التنبيهات. إذا وصلتك هالرسالة، التنبيهات شغالة.');
end $$;

revoke execute on function public.alerts_set(boolean, text[]), public.alerts_info(), public.alerts_test() from anon, public;
grant execute on function public.alerts_set(boolean, text[]), public.alerts_info(), public.alerts_test() to authenticated;

-- Every 30 minutes, with Supabase's scheduler.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'm2-alerts';
    perform cron.schedule('m2-alerts', '*/30 * * * *', 'select m2_ops.alerts_run()');
  else
    raise notice 'pg_cron is not available here: alerts are not scheduled';
  end if;
end $$;

notify pgrst, 'reload schema';
