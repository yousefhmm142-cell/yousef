-- =====================================================================
--  نظام مخيم 2: التحديث 43 · رسالة السولار بتحكي يوم ما بيخلص وموعد الطلب
--  يُطبَّق تلقائياً مع الرفع (أو الصقه في Supabase > SQL Editor ثم Run). تكراره لا يضر.
-- =====================================================================
-- The server's fuel alert (update-40) said «يكفي X يوم»; now it names the day it runs out and the day to
-- order by (two days before), like the generation report does.

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
      -- The day it runs out (the report's day + whole days it lasts), and two days before to order.
      body := 'مخيم 2: السولار قرب يخلص. الباقي ' || round(remaining) || ' لتر، بيخلص تقريباً '
              || to_char(rep.report_date + floor(remaining / daily)::int + 1, 'DD/MM') || '. اطلبوا قبل '
              || to_char(rep.report_date + floor(remaining / daily)::int - 1, 'DD/MM') || '.';
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

notify pgrst, 'reload schema';
