-- Local checks for the Mukhayyam 2 rules. Each line acts as a real signed-in user.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- ---------- Test helpers (superuser) ----------
create schema test;
grant usage on schema test to anon, authenticated;

create function test.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'FAIL: %', p_msg; end if;
  raise notice 'PASS: %', p_msg;
end $$;

create function test.fails(p_sql text, p_like text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ilike p_like then raise notice 'PASS: %', p_msg; return; end if;
    raise exception 'FAIL: % (got "%", expected "%")', p_msg, sqlerrm, p_like;
  end;
  raise exception 'FAIL: % (no error)', p_msg;
end $$;

create function test.affected(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

create function test.login(p_name text) returns void language plpgsql as $$
declare u uuid;
begin
  select auth_user_id into u from public.employees where full_name = p_name;
  if u is null then raise exception 'No login for %', p_name; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, false);
end $$;

grant execute on all functions in schema test to anon, authenticated;
create table test.ids (k text primary key, v uuid);
grant all on test.ids to authenticated;

-- ---------- People with logins ----------
with u as (
  insert into auth.users (email) values
    ('0590000001@m2.local'), ('0590000002@m2.local'), ('0590000003@m2.local'), ('0590000004@m2.local'),
    ('0590000005@m2.local'), ('0590000006@m2.local'), ('0590000007@m2.local')
  returning id, email
)
update public.employees e set auth_user_id = u.id, phone = split_part(u.email, '@', 1)
from u
where (e.full_name, split_part(u.email, '@', 1)) in (('رامي أبو عجوة', '0590000002'), ('قصي الشافعي', '0590000005'), ('مجد عاشور', '0590000006'));

insert into public.employees (full_name, role, phone, auth_user_id, tracks_attendance)
select v.n, v.r::public.user_role, v.p, (select id from auth.users where email = v.p || '@m2.local'), v.t
from (values ('مسؤول النظام', 'admin', '0590000001', true),
             ('مشغّل الموقع', 'generation_operator', '0590000003', false),
             ('مشرف التوزيع', 'distribution_supervisor', '0590000004', true),
             ('موظف إداري', 'staff', '0590000007', true)) v (n, r, p, t);

select test.ok((select count(*) from public.employees where auth_user_id is not null) = 7, 'seven test logins exist');
select test.ok((select count(*) from public.zones) = 6 and (select count(*) from public.task_types) = 16, 'seed: 6 zones and 16 task types');

-- ---------- Generation report ----------
select test.login('مشغّل الموقع'); set role authenticated;
select test.ok(public.current_user_role() = 'generation_operator', 'operator is recognised from the login');
select test.ok(public.server_now() is not null, 'server time is available to the app');
with r as (insert into public.site_reports (report_date, submitted_at) values ('2026-10-29', '2020-01-01') returning id)
insert into test.ids select 'report', id from r;
select test.ok((select submitted_at is null and status = 'draft' from public.site_reports where report_date = '2026-10-29'), 'operator cannot forge the send time on a draft');
insert into public.site_report_fuel (report_id, fuel_type_id, opening_balance, received_qty, total_qty, closing_balance, consumption, shipment_no)
  values ((select v from test.ids where k = 'report'), 1, 2600, 2000, 4600, 3600, 1000, '14520');
select test.ok(test.affected($$update public.site_report_fuel set notes = 'وصلت 10:15 ص'$$) = 1, 'operator edits a draft line');
select test.fails($$insert into public.site_report_fuel (report_id, fuel_type_id, closing_balance) values ((select v from test.ids where k = 'report'), 2, -5)$$,
                  '%check constraint%', 'negative fuel figures are refused');
reset role; insert into public.generators (name, brand) values ('مولد الأحمال', 'Cat'); set role authenticated;
insert into public.generator_day_logs (report_id, generator_id, did_run, band_loads)
  values ((select v from test.ids where k = 'report'), (select id from public.generators where name = 'مولد الأحمال'), true, '[180,180,null,200,200,190]'::jsonb);
select test.ok((select band_loads->>0 = '180' and band_loads->>2 is null from public.generator_day_logs), 'a generator keeps one reading per hourly band (empty = dash)');
select test.fails($$update public.generator_day_logs set band_loads = '[1,2]'::jsonb$$, '%check constraint%', 'a generator band table must have six bands');
update public.site_reports set status = 'submitted' where report_date = '2026-10-29';
select test.ok((select submitted_at is not null and submitted_by = public.current_employee_id() from public.site_reports where report_date = '2026-10-29'), 'sending stamps server time and sender');
select test.ok(test.affected($$update public.site_report_fuel set notes = 'تعديل بعد الإرسال'$$) = 0, 'operator cannot edit lines after sending');
select test.fails($$update public.site_reports set general_notes = 'x' where report_date = '2026-10-29'$$, '%can no longer be edited%', 'operator cannot edit a sent report');
select test.fails($$update public.site_reports set status = 'approved' where report_date = '2026-10-29'$$, '%can no longer be edited%', 'operator cannot approve');

reset role; select test.login('رامي أبو عجوة'); set role authenticated;
select test.fails($$update public.site_reports set status = 'returned' where report_date = '2026-10-29'$$, '%needs a reason%', 'returning needs a reason');
update public.site_reports set submitted_at = '2020-01-01' where report_date = '2026-10-29';
select test.ok((select submitted_at > '2026-01-01' from public.site_reports where report_date = '2026-10-29'), 'manager cannot rewrite the send time');
update public.site_reports set status = 'approved' where report_date = '2026-10-29';
select test.ok((select approved_at is not null and approved_by = public.current_employee_id() from public.site_reports where report_date = '2026-10-29'), 'approval stamps server time and manager');
select test.fails($$update public.site_reports set status = 'draft' where report_date = '2026-10-29'$$, '%approve a closed day or reopen%', 'an approved day cannot go back to draft');
select test.fails($$update public.site_reports set status = 'returned' where report_date = '2026-10-29'$$, '%needs a reason%', 'reopening a day needs a reason');
update public.site_reports set status = 'returned', returned_reason = 'الاستهلاك غير منطقي' where report_date = '2026-10-29';
select test.ok((select status = 'returned' and approved_at is null from public.site_reports where report_date = '2026-10-29'), 'the manager reopens even an approved day');
select test.ok((select count(*) from public.audit_log where table_name = 'site_reports') >= 2, 'changes are kept in the history');

reset role; select test.login('موظف إداري'); set role authenticated;
select test.ok((select count(*) from public.site_reports) = 0, 'staff cannot see generation reports');
select test.fails($$insert into public.site_reports (report_date) values ('2026-10-30')$$, '%row-level security%', 'staff cannot create a report');
select test.ok((select count(*) from public.zones) = 6, 'staff can read reference lists');
select test.ok(test.affected($$update public.employees set role = 'admin'$$) = 0, 'nobody but the admin can change roles');

-- ---------- Distribution sheet ----------
reset role; select test.login('مشرف التوزيع'); set role authenticated;
insert into public.distribution_sheets (sheet_date) values ('2026-10-29');
insert into public.zone_day_entries (sheet_id, zone_id, supply_hours)
  select id, 1, 6 from public.distribution_sheets where sheet_date = '2026-10-29';
insert into public.zone_runs (entry_id, run_no, start_time, end_time, load_l1, load_l2, load_l3)
  select id, 1, '20:00', '01:00', 120, 110, 118 from public.zone_day_entries;
select test.ok((select count(*) from public.zone_runs) = 1, 'supervisor records a run that crosses midnight');
select test.fails($$insert into public.zone_runs (entry_id, run_no) select id, 7 from public.zone_day_entries$$, '%check constraint%', 'a seventh run is refused');
update public.zone_day_entries set band_loads = '[[1,2,3],[1,2,3],[1,2,3],[1,2,3],[1,2,3],[null,null,null]]'::jsonb;
select test.ok((select jsonb_array_length(band_loads) = 6 from public.zone_day_entries), 'a zone keeps its six hourly bands');
select test.fails($$update public.zone_day_entries set band_loads = '[[1,2,3]]'::jsonb$$, '%check constraint%', 'a band table must have six bands');
reset role; select test.login('مشغّل الموقع'); set role authenticated;
select test.ok((select count(*) from public.distribution_sheets) = 1, 'the site employee also sees the distribution sheet');
select test.ok(test.affected($$update public.zone_runs set load_l1 = 121$$) = 1, 'any site employee can fix a draft sheet');
reset role; select test.login('مشرف التوزيع'); set role authenticated;
select test.ok((select count(*) from public.site_reports) = 1, 'the second site role also sees the generation report');
update public.distribution_sheets set status = 'submitted' where sheet_date = '2026-10-29';
reset role; select test.login('مشغّل الموقع'); set role authenticated;
select test.fails($$update public.distribution_sheets set notes = 'x'$$, '%can no longer be edited%', 'a sent sheet is closed for the whole site');
select test.ok(test.affected($$update public.zone_runs set load_l1 = 1$$) = 0, 'lines of a sent sheet are closed too');

-- ---------- Tasks ----------
reset role; select test.login('رامي أبو عجوة'); set role authenticated;
with t as (
  insert into public.tasks (task_type_id, assignee_id, expected_minutes, status, zone_id, details)
  values (4, (select id from public.employees where full_name = 'قصي الشافعي'), 45, 'done', 2, 'تبديل ساعة قرب المسجد')
  returning id)
insert into test.ids select 'task1', id from t;
select test.ok((select status = 'new' and number >= 1 from public.tasks where id = (select v from test.ids where k = 'task1')), 'a new task always starts as new');
insert into public.outgoing_messages (task_id, channel, to_phone, body)
  values ((select v from test.ids where k = 'task1'), 'sms', '0590000005', 'مهمة جديدة');
select test.ok((select status = 'sent' and sent_at is not null from public.tasks where id = (select v from test.ids where k = 'task1')), 'sending an SMS marks the task as sent');

reset role; select test.login('مجد عاشور'); set role authenticated;
select test.ok((select count(*) from public.tasks) = 0, 'a technician does not see other technicians'' tasks');
select test.ok(test.affected($$update public.tasks set status = 'in_progress'$$) = 0, 'a technician cannot start another person''s task');

reset role; select test.login('قصي الشافعي'); set role authenticated;
select test.ok((select count(*) from public.tasks) = 1, 'a technician sees their own task');
select test.fails($$update public.tasks set expected_minutes = 300$$, '%only start, finish%', 'a technician cannot change the task details');
select test.fails($$update public.tasks set status = 'done'$$, '%Invalid task step%', 'a task cannot be finished before it starts');
update public.tasks set status = 'in_progress', recorded_offline = true, device_time = now() + interval '3 hours';
select test.ok((select started_at <= now() from public.tasks), 'an offline start time from the future is pulled back to server time');
update public.tasks set status = 'done', completion_notes = 'تم التبديل';
select test.ok((select status = 'done' and completed_at >= started_at and actual_minutes >= 0 from public.tasks), 'finishing records the time taken');
select test.ok((select string_agg(event, ',' order by id) from public.task_events) = 'created,sent_sms,started,completed', 'the task history is complete');
select test.fails($$update public.tasks set status = 'in_progress'$$, '%Invalid task step%', 'a finished task cannot be reopened by the technician');
select test.ok((select count(*) from public.attendance_points) = 0, 'employees cannot read the attendance QR code');
select test.fails($$insert into public.attendance_punches (employee_id, kind, method, point_id) values (public.current_employee_id(), 'in', 'qr', 1)$$,
                  '%row-level security%', 'employees cannot write punches directly');

reset role; select test.login('رامي أبو عجوة'); set role authenticated;
select test.fails($$update public.tasks set assignee_id = (select id from public.employees where full_name = 'مجد عاشور')$$, '%cannot be reassigned%', 'a finished task cannot be reassigned');
insert into public.tasks (task_type_id, assignee_id, expected_minutes) values (6, (select id from public.employees where full_name = 'مجد عاشور'), 30);
update public.tasks set status = 'cancelled' where status = 'new';
select test.ok((select count(*) from public.tasks where status = 'cancelled' and cancelled_at is not null and cancel_reason is null) = 1, 'the manager cancels without a reason');
insert into public.tasks (task_type_id, assignee_id, expected_minutes) values (6, (select id from public.employees where full_name = 'مجد عاشور'), 30);
update public.tasks set status = 'cancelled', cancel_reason = 'المشترك غير موجود' where status = 'new';
select test.ok((select count(*) from public.tasks where status = 'cancelled' and cancelled_at is not null and cancel_reason = 'المشترك غير موجود') = 1, 'optional reasons from older clients are preserved');
select test.ok((select count(*) from public.attendance_points) = 1, 'the manager can print the attendance sheet');

-- Task links: the technician has no login; the link in the message is enough for one task only.
with t as (
  insert into public.tasks (task_type_id, assignee_id, expected_minutes, details)
  values (1, (select id from public.employees where full_name = 'مجد عاشور'), 30, 'شد كابل لبيت أبو محمد')
  returning id)
insert into test.ids select 'task2', id from t;
select test.ok((select length(link_token) = 16 from public.tasks where id = (select v from test.ids where k = 'task2')), 'every task gets its own private link');
insert into public.outgoing_messages (task_id, channel, to_phone, body)
  values ((select v from test.ids where k = 'task2'), 'whatsapp', '0590000006', 'مهمة');
reset role;
create table test.link as select link_token from public.tasks where id = (select v from test.ids where k = 'task2');
grant select on test.link to anon, authenticated;
select test.login('رامي أبو عجوة'); set role authenticated;
-- The manager opening the link on their own laptop also works.
select test.ok(public.task_link_act((select link_token from test.link), 'start') ->> 'status' = 'in_progress', 'the link works even for a signed-in manager');

reset role; select set_config('request.jwt.claims', '', false); set role anon;
select test.ok(public.task_link_view('wrong-token-0000') is null, 'a wrong link shows nothing');
select test.ok(public.task_link_view((select link_token from test.link)) ->> 'details' = 'شد كابل لبيت أبو محمد', 'the link shows the order without signing in');
select test.ok(jsonb_array_length(public.task_link_view((select link_token from test.link)) -> 'items') = 7, 'the link lists the warehouse items to pick from');
select test.ok((public.task_link_act((select link_token from test.link), 'done', 'تم الشد', '[{"item_id": 5, "qty": 25}, {"item_id": 7, "qty": 1}, {"item_id": 7, "qty": 0}]') ->> 'status') = 'done', 'one tap on the link finishes the task');
select test.ok((public.task_link_act((select link_token from test.link), 'done') ->> 'status') = 'done', 'pressing twice changes nothing');
select test.fails($$select count(*) from public.tasks$$, '%permission denied%', 'the link opens no other data');
reset role;
select test.ok((select completed_at is not null and completion_notes = 'تم الشد' from public.tasks where id = (select v from test.ids where k = 'task2')),
               'the manager sees when it was finished and the note');
select test.ok((select string_agg(event, ',' order by id) from public.task_events where task_id = (select v from test.ids where k = 'task2'))
               = 'created,sent_whatsapp,started,completed', 'the link steps are in the task history');
select test.ok((select actor_id = assignee_id from public.task_events e join public.tasks t on t.id = e.task_id
                where e.task_id = (select v from test.ids where k = 'task2') and event = 'completed'), 'the history names the technician');
select test.ok((select count(*) = 2 and bool_and(kind = 'out' and created_by = (select assignee_id from public.tasks where id = (select v from test.ids where k = 'task2')))
                from public.stock_moves where task_id = (select v from test.ids where k = 'task2')), 'materials from the link come off the warehouse, in the technician''s name');
select test.fails($$select public.task_link_act((select link_token from public.tasks where status = 'cancelled' limit 1), 'done')$$,
                  'cancelled', 'a cancelled task cannot be finished from its link');
select test.login('رامي أبو عجوة'); set role authenticated;

-- ---------- Attendance by the printed QR (no app, no login) ----------
reset role; select test.login('مسؤول النظام'); set role authenticated;
select public.admin_set_attendance((select id from public.employees where full_name = 'موظف إداري'), (select id from public.work_schedules where name = 'بطالة'), '4821');
select test.fails($$select public.admin_set_attendance((select id from public.employees where full_name = 'موظف إداري'), null, '12')$$, 'bad_code', 'the attendance code is 4 digits');
select test.ok((select count(*) from public.attendance_code_holders()) = 1, 'the admin sees who has a code, never the code');
reset role;
create table test.point as select code from public.attendance_points limit 1;
grant select on test.point to anon, authenticated;
create table test.dev (token text);
grant all on test.dev to anon, authenticated;
create table test.emp as select id from public.employees where full_name = 'موظف إداري';
grant select on test.emp to anon, authenticated;
select set_config('request.jwt.claims', '', false); set role anon;
select test.fails($$select * from public.attendance_codes$$, '%permission denied%', 'nobody can read attendance codes');
select test.ok((select count(*) from public.attendance_people((select code from test.point))) >= 1, 'the sheet lists the people who record attendance');
select test.fails($$select * from public.attendance_people('old-sheet')$$, 'bad_point', 'an old or fake sheet shows no names');
select test.ok(public.attendance_register((select code from test.point), (select id from test.emp), '0000') is null, 'a wrong code registers nothing');
insert into test.dev select public.attendance_register((select code from test.point), (select id from test.emp), '4821', 'Android');
select test.ok((select length(token) = 48 from test.dev), 'the right code gives this phone its private key');
select test.ok((public.attendance_punch((select code from test.point), (select token from test.dev)) -> 'punches' -> 0 ->> 'kind') = 'in', 'the first scan of the day is "in"');
select test.ok((public.attendance_punch((select code from test.point), (select token from test.dev)) ->> 'repeat')::boolean, 'a second scan within two minutes records nothing new');
reset role;
update public.attendance_punches set at = at - interval '10 minutes';
select set_config('request.jwt.claims', '', false); set role anon;
select test.ok((public.attendance_punch((select code from test.point), (select token from test.dev)) ->> 'status') = 'wait', 'a scan 10 minutes after arriving does not end the day');
select test.ok(public.attendance_punch((select code from test.point), (select token from test.dev)) ->> 'wait_until' is not null, 'and says when the departure can be recorded');
select test.ok((public.attendance_punch((select code from test.point), (select token from test.dev), null, null, null, true) ->> 'status') = 'wait', 'peeking records nothing and tells the same');
reset role;
update public.attendance_punches set at = at - interval '3 hours';
select set_config('request.jwt.claims', '', false); set role anon;
select test.ok(jsonb_array_length(public.attendance_punch((select code from test.point), (select token from test.dev)) -> 'punches') = 2, 'the next scan is "out"');
select test.ok((public.attendance_punch((select code from test.point), (select token from test.dev)) ->> 'status') = 'full', 'a third scan the same day records nothing: two a day');
reset role;
update public.attendance_points set lat = 31.5, lng = 34.45, radius_m = 100;
select set_config('request.jwt.claims', '', false); set role anon;
select test.fails($$select public.attendance_punch((select code from test.point), (select token from test.dev))$$, 'need_location', 'with the office place set, a scan must bring the phone place');
select test.fails($$select public.attendance_punch((select code from test.point), (select token from test.dev), 31.51, 34.45, 10)$$, 'too_far:%', 'a scan from 1 km away is refused');
select test.ok((public.attendance_punch((select code from test.point), (select token from test.dev), 31.5003, 34.4503, 10) ->> 'status') = 'full', 'a scan from inside the office is accepted');
reset role;
update public.attendance_points set lat = null, lng = null;
select set_config('request.jwt.claims', '', false); set role anon;
select test.fails($$select public.attendance_punch((select code from test.point), 'stolen-or-made-up')$$, 'unknown_device', 'an unknown phone cannot record');
select test.fails($$select public.attendance_punch('old-sheet', (select token from test.dev))$$, 'bad_point', 'a photo of an old sheet does not work');
select test.fails($$select count(*) from public.attendance_punches$$, '%permission denied%', 'the sheet opens no other data');
select public.attendance_register((select code from test.point), (select id from test.emp), '1111') from generate_series(1, 5);
select test.fails($$select public.attendance_register((select code from test.point), (select id from test.emp), '4821')$$, 'locked', 'five wrong codes lock it for a while');
reset role;
select test.ok((select count(*) = 2 and bool_and(method = 'qr') from public.attendance_punches where employee_id = (select id from test.emp)), 'scans are stored as QR punches');
select test.login('رامي أبو عجوة'); set role authenticated;
select test.ok(test.affected($$update public.attendance_devices set revoked_at = now()$$) = 1, 'the manager can switch a phone off');
reset role; select set_config('request.jwt.claims', '', false); set role anon;
select test.fails($$select public.attendance_punch((select code from test.point), (select token from test.dev))$$, 'unknown_device', 'a switched-off phone cannot record');
reset role; select test.login('رامي أبو عجوة'); set role authenticated;

-- ---------- Warehouse and nightly copies ----------
reset role; select test.login('رامي أبو عجوة'); set role authenticated;
insert into public.stock_moves (item_id, kind, qty, ref) values (5, 'in', 500, 'فاتورة 77');
select test.ok((select sum(case kind when 'in' then qty else -qty end) from public.stock_moves where item_id = 5) = 475, 'balance = in − out');
select test.ok((select created_by = public.current_employee_id() from public.stock_moves where ref = 'فاتورة 77'), 'every move carries who entered it');
select test.fails($$insert into public.stock_moves (item_id, kind, qty) values (5, 'out', 0)$$, '%check constraint%', 'a move needs a quantity');
select test.ok((select count(*) from public.backup_list()) >= 1, 'the manager sees the nightly copies');
reset role; select test.login('مشغّل الموقع'); set role authenticated;
select test.ok((select count(*) from public.stock_moves) = 0, 'site staff do not see the warehouse');
select test.ok((select count(*) from public.backups) = 0 and (select count(*) from public.backup_list()) = 0, 'site staff do not see the copies');
reset role; select set_config('request.jwt.claims', '', false); set role anon;
select test.fails($$select public.take_backup()$$, '%permission denied%', 'nobody can trigger a copy from outside');
reset role; select test.login('رامي أبو عجوة'); set role authenticated;

-- ---------- People and logins ----------
reset role; select test.login('موظف إداري'); set role authenticated;
select test.fails($$select public.admin_save_employee(null, 'زيد', 'technician', '0591111111', '123456', true, true)$$,
                  'not_allowed', 'only the manager or the admin adds people');
reset role; select test.login('رامي أبو عجوة'); set role authenticated;
select test.ok(public.admin_save_employee(null, 'فني من المدير', 'technician', '0591111119', null, true, true) is not null, 'the manager adds people too');
select public.admin_set_attendance((select id from public.employees where phone = '0591111119'), null, '7788');
select test.ok((select count(*) from public.attendance_code_holders()) = 2, 'the manager gives attendance codes too');
reset role; select test.login('مسؤول النظام'); set role authenticated;
select test.ok(not public.setup_needed(), 'first-time setup is closed once an admin can sign in');
select test.ok(public.admin_save_employee(null, 'زيد الفني', 'technician', '0591111111', '123456', true, true) is not null,
               'the admin adds a technician with a login');
select test.ok((select auth_user_id is not null from public.employees where phone = '0591111111'), 'the new person has a login');
select test.fails($$select public.admin_save_employee(null, 'آخر', 'technician', '0591111111', '123456', true, true)$$,
                  'phone_taken', 'one phone belongs to one person');
select test.fails($$select public.admin_save_employee(null, 'آخر', 'technician', '0591111112', '12345', true, true)$$,
                  'bad_pin', 'a PIN is exactly 6 digits');
select test.fails($$select public.admin_save_employee(null, 'آخر', 'technician', '059111', '123456', true, true)$$,
                  'bad_phone', 'a phone is 10 digits starting with 05');
select test.fails($$select public.admin_save_employee(public.current_employee_id(), 'مسؤول النظام', 'admin', '0590000001', null, false, true)$$,
                  'last_admin', 'the last admin cannot switch themselves off');
select test.fails($$select public.save_login_account(null, '0591111113', '123456')$$,
                  '%permission denied%', 'accounts are only made through the admin screen');


-- ---------- Seals ----------
reset role; select test.login('رامي أبو عجوة'); set role authenticated;
select test.ok(public.has_seals(), 'the manager has the seals permission by default');
select test.ok(public.seal_add_roll(181301, 181400, public.seal_today(), null) is not null, 'a roll of 100 seals is registered');
select test.ok((select count(*) from public.seals where status = 'in_stock') = 100, 'all its numbers start in stock');
select test.fails($$select public.seal_add_roll(181350, 181450, public.seal_today(), null)$$, 'roll_overlap', 'two rolls cannot share numbers');
select test.ok(public.seal_add_roll(183001, null, public.seal_today(), 'ملاحظة') is not null, 'a roll with no end is 100 long');
select test.ok((select to_no from public.seal_rolls where from_no = 183001) = 183100, '183001 ends at 183100');
select test.ok(public.seal_board_no('طبلون 361 إعادة شبك (حمزة)') = '361' and public.seal_board_no('طبلون الحملاوي 27 (تفتيش)') = 'الحملاوي 27'
               and public.seal_board_no('بدون') is null, 'the tableau number is read from the details');

select public.seal_issue((select id from public.employees where full_name = 'قصي الشافعي'), public.seal_today(), array[181365, 181388, 181355], 'x');
select test.ok((select count(*) from public.seals where status = 'issued' and technician_id = (select id from public.employees where full_name = 'قصي الشافعي')) = 3,
               'three seals are handed to a technician');
select test.ok((select batch_no from public.seal_batches) = 1, 'the first batch of the roll is number one');
select test.ok((select string_agg(seal_no::text, '-' order by batch_pos) from public.seals where batch_id is not null) = '181365-181388-181355', 'the order they were taken is kept');
select test.fails($$select public.seal_issue((select id from public.employees where full_name = 'قصي الشافعي'), public.seal_today(), array[181365], null)$$, 'not_available:181365', 'a seal already issued cannot be issued again');
select test.fails($$select public.seal_issue((select id from public.employees where full_name = 'قصي الشافعي'), public.seal_today(), array[999999], null)$$, 'unknown_seal:999999', 'an unknown number is refused');
select test.fails($$select public.seal_issue((select id from public.employees where full_name = 'قصي الشافعي'), public.seal_today(), array[181301, 183002], null)$$, 'mixed_rolls', 'one batch comes from one roll');
select test.fails($$select public.seal_issue((select id from public.employees where full_name = 'قصي الشافعي'), public.seal_today(), array[181301, 181301], null)$$, 'duplicate_seal', 'a number twice in a batch is refused');
select test.fails($$select public.seal_issue((select id from public.employees where full_name = 'رامي أبو عجوة'), public.seal_today(), array[181301], null)$$, 'bad_technician', 'seals go to technicians only');
select public.seal_issue((select id from public.employees where full_name = 'مجد عاشور'), public.seal_today() - 1, array[181301, 181302], null);
select test.ok((select batch_no from public.seal_batches where technician_id = (select id from public.employees where full_name = 'مجد عاشور')) = 2, 'the second batch of the roll is number two');

select public.seal_record(181365, 'used', null, 'طبلون 361 إعادة شبك (حمزة الداية)');
select test.ok((select status || ':' || board_no from public.seals where seal_no = 181365) = 'used:361', 'a used seal keeps its tableau number');
select test.fails($$select public.seal_record(181310, 'used', null, 'x')$$, 'not_issued:181310', 'a seal still in stock cannot be marked used');
select public.seal_record(181310, 'damaged', null, 'تالف');
select test.ok((select status from public.seals where seal_no = 181310) = 'damaged', 'a damaged seal can be marked straight from stock');
select test.fails($$select public.seal_unissue(array[181365])$$, 'already_used', 'a used seal cannot be taken back');
select test.ok(public.seal_unissue(array[181301, 181302]) = 2, 'seals handed out by mistake go back to stock');
select test.ok((select count(*) from public.seal_batches) = 1, 'a batch left empty disappears');
select test.fails($$select public.seal_delete_roll((select id from public.seal_rolls where from_no = 181301))$$, 'roll_in_use', 'a roll in use cannot be deleted');
select public.seal_delete_roll((select id from public.seal_rolls where from_no = 183001));
select test.ok((select count(*) from public.seal_rolls) = 1, 'an untouched roll can be deleted');

-- A staff member sees seals only when given the permission.
reset role; select test.login('موظف إداري'); set role authenticated;
select test.fails($$select public.seal_add_roll(190001, null, public.seal_today(), null)$$, 'not_allowed', 'staff without the permission cannot touch seals');
select test.ok((select count(*) from public.seals) = 0, 'and see no seal');
reset role; select test.login('رامي أبو عجوة'); set role authenticated;
select public.admin_set_seals_access((select id from public.employees where full_name = 'موظف إداري'), true);
reset role; select test.login('موظف إداري'); set role authenticated;
select test.ok((select count(*) from public.seals) = 100, 'with the permission the seals are visible');
select test.ok(public.seal_add_roll(190001, null, public.seal_today(), null) is not null, 'and a roll can be registered');
select test.fails($$select public.seal_import_roll('{"from":195001,"to":195100,"received_on":"2026-10-01"}'::jsonb)$$, 'not_allowed', 'only managers import old files');
select test.fails($$update public.seals set status = 'used' where seal_no = 190001$$, '%permission denied%', 'seals are never written straight into the table');
reset role; select test.login('مجد عاشور'); set role authenticated;
select test.ok((select count(*) from public.seals) = 0, 'a technician sees no seals');
select test.fails($$select public.seal_record(181365, 'lost', null, null)$$, 'not_allowed', 'a technician cannot change seals');


-- ---------- Seals: editing and taking back ----------
reset role; select test.login('رامي أبو عجوة'); set role authenticated;
select public.seal_add_roll(170001, null, public.seal_today(), null);
select public.seal_issue((select id from public.employees where full_name = 'قصي الشافعي'), public.seal_today(), array[170001, 170002, 170003], null);
select public.seal_record(170001, 'used', null, 'طبلون 9 تفتيش');
select public.seal_update_batch((select batch_id from public.seals where seal_no = 170001), (select id from public.employees where full_name = 'مجد عاشور'), public.seal_today() - 2);
select test.ok((select count(*) from public.seals where seal_no in (170001, 170002, 170003) and technician_id = (select id from public.employees where full_name = 'مجد عاشور') and issued_on = public.seal_today() - 2) = 3,
               'changing a batch changes all its seals');
select test.fails($$select public.seal_update_batch((select batch_id from public.seals where seal_no = 170001), (select id from public.employees where full_name = 'رامي أبو عجوة'), public.seal_today())$$, 'bad_technician', 'a batch can only be moved to a technician');
select test.ok(public.seal_return_to_stock(array[170001]) = 1, 'a used seal can be taken back to the stock');
select test.ok((select status || ':' || coalesce(details, '-') from public.seals where seal_no = 170001) = 'in_stock:-', 'and its record is cleared');
select test.ok(public.seal_delete_batch((select batch_id from public.seals where seal_no = 170002)) = 2, 'deleting a batch returns the rest of its seals');
select test.ok((select count(*) from public.seal_batches b join public.seal_rolls r on r.id = b.roll_id where r.from_no = 170001) = 0, 'and the batch is gone');
select public.seal_update_roll((select id from public.seal_rolls where from_no = 170001), public.seal_today() - 1, 'ملاحظة جديدة');
select test.ok((select note from public.seal_rolls where from_no = 170001) = 'ملاحظة جديدة', 'a roll note can be changed');
select test.ok(public.seal_delete_batch(gen_random_uuid()) = 0, 'deleting a batch that is not there does nothing');
reset role; select test.login('موظف إداري'); set role authenticated;
select test.ok(public.has_seals(), 'the permission given earlier still holds');
reset role; select test.login('مجد عاشور'); set role authenticated;
select test.fails($$select public.seal_delete_batch(gen_random_uuid())$$, 'not_allowed', 'a technician cannot delete batches');

-- The tableau as she writes it: the whole name with its number.
select test.ok(public.seal_board_no('طبلون 361 إعادة شبك (حمزة الداية )') = '361', 'board: number first');
select test.ok(public.seal_board_no('طبلون أبو هويشل 10 فصل خالد') = 'أبو هويشل 10', 'board: name then number');
select test.ok(public.seal_board_no('طبلون شمال المقبرة (19) فصل خدمة') = 'شمال المقبرة 19', 'board: number in brackets');
select test.ok(public.seal_board_no('طبلون ساعات برج 10B إضافة مشتركين') = 'ساعات برج 10B', 'board: letter stuck to the number');
select test.ok(public.seal_board_no('طبلون 8 a  الأبراج   ( تغيير )') = '8 a الأبراج', 'board: number, letter, then the name');
select test.ok(public.seal_board_no('طبلون 12 فصل (احمد )') = '12', 'board: the work word is not part of it');
select test.ok(public.seal_board_no('تفتيش') is null, 'board: none when no tableau is named');

-- Importing an old roll (manager).
reset role; select test.login('مسؤول النظام'); set role authenticated;
select test.ok((public.seal_import_roll(jsonb_build_object('from', 162701, 'to', 162800, 'received_on', '2026-09-29', 'header_text', 'تاريخ الاستلام 29/9/2026 الاختام (162701-162800)', 'sheet_label', 'ورقة13', 'sheet_pos', 0, 'sheet_col', 4,
        'batches', jsonb_build_array(jsonb_build_object('date', '2026-09-30', 'tech', (select id from public.employees where full_name = 'مجد عاشور'), 'seals', jsonb_build_array(162778, 162707, 162737, 163000))),
        'damaged', jsonb_build_array(162799))) ->> 'issued') = '3',
               'an old roll is imported with its batch');
select test.ok((select original_seals = array[162778, 162707, 162737, 163000] from public.seal_batches where original_seals is not null), 'the batch keeps its line as written');
select test.ok((select header_text || '/' || sheet_label from public.seal_rolls where from_no = 162701) = 'تاريخ الاستلام 29/9/2026 الاختام (162701-162800)/ورقة13', 'the roll keeps its heading and sheet');
select test.ok(public.seal_import_usage(jsonb_build_array(jsonb_build_object('no', 162778, 'status', 'used', 'used_on', '2026-10-01', 'details', 'طبلون 5 تفتيش'),
                                    jsonb_build_object('no', 162799, 'status', 'damaged', 'used_on', '', 'details', 'تالف'),
                                    jsonb_build_object('no', 162750, 'status', 'used', 'used_on', '2026-10-01', 'details', 'x'))) = 2, 'usage lines are applied once the batches are in (one is for a seal not issued)');
select public.seal_return_to_stock(array[162707]);
select test.ok((select original_seals is null from public.seal_batches where id = (select batch_id from public.seals where seal_no = 162778)), 'a batch someone changes stops following its written line');
select test.ok((select status || ':' || board_no from public.seals where seal_no = 162778) = 'used:5', 'imported usage keeps the tableau number');
select test.ok((select status from public.seals where seal_no = 162799) = 'damaged', 'imported damaged seals are marked');
select test.ok((public.seal_import_roll(jsonb_build_object('from', 162701, 'to', 162800, 'received_on', '2026-09-29')) ->> 'skipped')::boolean, 'importing the same roll again changes nothing');
select test.ok(public.seal_import_technician('قصي  الشافعي') = (select id from public.employees where full_name = 'قصي الشافعي'), 'the same technician is found under another spacing');
select test.ok(public.seal_import_technician('مجد') = (select id from public.employees where full_name = 'مجد عاشور'), 'a first name finds the one technician');
select test.ok(public.seal_import_technician('مهند دويدار', 'مهند') is not null, 'a name is matched or added');
insert into public.employees (id, full_name, role, is_active) values ('00000000-0000-0000-0000-0000000000a1', 'سامر خالد الحلبي', 'technician', true);
select test.ok(public.seal_import_technician('سامر الحلبي') = '00000000-0000-0000-0000-0000000000a1', 'first and last word find the full name');
select test.ok(public.seal_import_technician('سامرالحلبي') = '00000000-0000-0000-0000-0000000000a1', 'words run together find it too');
select test.ok(public.seal_import_technician('سامر') = '00000000-0000-0000-0000-0000000000a1', 'a first name finds the only one');
select public.seal_import_technician('أيمن اللخاوي');
select test.ok((select not is_active and role = 'technician' from public.employees where full_name = 'أيمن اللخاوي'), 'an unknown technician is added switched off');

-- ---------- Not signed in ----------
reset role; select set_config('request.jwt.claims', '', false); set role anon;
select test.fails($$select count(*) from public.seals$$, '%permission denied%', 'seals are closed to a visitor');
select test.fails($$select public.seal_issue(null, null, null, null)$$, '%permission denied%', 'and so are the seal functions');
select test.fails($$select count(*) from public.employees$$, '%permission denied%', 'nothing is readable without signing in');
select test.fails($$select public.setup_first_admin('دخيل', '0592222222', '123456')$$, 'already_set_up',
                  'nobody can claim the first admin once it exists');
reset role;

-- ---------- Pages the manager opens for a person (reading only) ----------
reset role; select test.login('مسؤول النظام'); set role authenticated;
select test.ok(public.has_page('stock'), 'the admin has every page');
select public.admin_set_pages((select id from public.employees where full_name = 'موظف إداري'), array['stock', 'attendance', 'bogus']);
select test.ok((select pages = array['attendance', 'stock'] from public.employees where full_name = 'موظف إداري'), 'only known pages are kept');
reset role; select test.login('موظف إداري'); set role authenticated;
select test.ok(public.has_page('stock') and not public.has_page('tasks'), 'the person has exactly the pages given');
select test.ok((select count(*) from public.attendance_punches) >= 0, 'a granted page can be read');
select test.fails($$select public.admin_set_pages(public.current_employee_id(), array['tasks'])$$, '%not_allowed%', 'a person cannot give themselves pages');
select test.fails($$insert into public.stock_moves (item_id, kind, qty) values (1, 'in', 1)$$, '%row-level security%', 'a granted page is read-only');
reset role; select test.login('مشغّل الموقع'); set role authenticated;
select test.ok((select count(*) from public.tasks) = 0 and not public.has_page('tasks'), 'someone without the page sees no tasks');
reset role;

-- ---------- A page given to someone: they also fill and send that form ----------
reset role; select test.login('مسؤول النظام'); set role authenticated;
select public.admin_set_pages((select id from public.employees where full_name = 'موظف إداري'), array['generation']);
reset role; select test.login('موظف إداري'); set role authenticated;
insert into public.site_reports (report_date) values ('2026-11-01');
select test.ok((select count(*) from public.site_reports where report_date = '2026-11-01') = 1, 'whoever has the generation page fills a report');
update public.site_reports set status = 'submitted' where report_date = '2026-11-01';
select test.ok((select status = 'submitted' from public.site_reports where report_date = '2026-11-01'), 'and sends it');
select test.fails($$update public.site_reports set status = 'approved' where report_date = '2026-11-01'$$, '%', 'but cannot approve it');
select test.fails($$insert into public.distribution_sheets (sheet_date) values ('2026-11-01')$$, '%row-level security%', 'the generation page does not open the distribution sheet');
reset role; select test.login('مسؤول النظام'); set role authenticated;
select public.admin_set_pages((select id from public.employees where full_name = 'موظف إداري'), array['attendance']);
reset role; select test.login('موظف إداري'); set role authenticated;
select test.fails($$insert into public.site_reports (report_date) values ('2026-11-02')$$, '%row-level security%', 'take the page away and they cannot fill it');
reset role;

-- ---------- Deleting a person (branch manager only) ----------
reset role; select test.login('مشغّل الموقع'); set role authenticated;
select test.fails($$select public.admin_delete_employee((select id from public.employees where full_name = 'موظف إداري'))$$, '%not_allowed%', 'the site cannot delete people');
reset role; select test.login('مسؤول النظام'); set role authenticated;
select test.fails($$select public.admin_delete_employee((select id from public.employees where full_name = 'موظف إداري'))$$, '%not_allowed%', 'the admin cannot delete people either');
reset role; select test.login('رامي أبو عجوة'); set role authenticated;
select test.fails($$select public.admin_delete_employee(public.current_employee_id())$$, '%self%', 'nobody deletes themselves');
select test.fails($$select public.admin_delete_employee((select id from public.employees where full_name = 'مسؤول النظام'))$$, '%protected%', 'the admin cannot be deleted');
select public.admin_delete_employee((select id from public.employees where full_name = 'موظف إداري'));
reset role;
select test.ok((select deleted_at is not null and not is_active from public.employees where full_name = 'موظف إداري'), 'a deleted person is out and waits in the trash');
select test.login('رامي أبو عجوة'); set role authenticated;
select public.admin_restore_employee((select id from public.employees where full_name = 'موظف إداري'));
reset role;
select test.ok((select deleted_at is null and is_active from public.employees where full_name = 'موظف إداري'), 'the trash gives them back');

-- ---------- A batch prepared without a name, named later ----------
reset role; select test.login('مسؤول النظام'); set role authenticated;
select public.seal_add_roll(240101, 240200, '2026-10-30', null);
select test.ok((public.seal_issue(null, '2026-10-30', array[240101, 240102, 240103], null) ->> 'count') = '3', 'a batch can be prepared without a name');
select test.ok((select count(*) from public.seals where seal_no in (240101, 240102, 240103) and status = 'issued' and technician_id is null) = 3, 'its seals are issued to no one yet');
select test.fails($$select public.seal_record(240101, 'used', null, 'طبلون 5')$$, '%not_issued%', 'nothing is recorded on a batch without a name');
select test.fails($$select public.seal_assign_batch((select batch_id from public.seals where seal_no = 240101), (select id from public.employees where full_name = 'مشغّل الموقع'))$$, '%bad_technician%', 'only a technician can take a batch');
select public.seal_assign_batch((select batch_id from public.seals where seal_no = 240101), (select id from public.employees where full_name = 'قصي الشافعي'));
select test.ok((select count(*) from public.seals where seal_no in (240101, 240102, 240103) and technician_id = (select id from public.employees where full_name = 'قصي الشافعي')) = 3, 'naming the batch names all its seals');
select public.seal_record(240101, 'used', null, 'طبلون 5');
-- ---------- Adding new seals to a batch already made (again and again) ----------
select test.ok(public.seal_add_to_batch((select batch_id from public.seals where seal_no = 240101), array[240104, 240105]) = 2, 'new seals can join an existing batch');
select test.ok((select count(*) from public.seals where seal_no in (240104, 240105) and status = 'issued' and technician_id = (select id from public.employees where full_name = 'قصي الشافعي') and batch_id = (select batch_id from public.seals where seal_no = 240101)) = 2, 'they take the batch name and day');
select test.ok(public.seal_add_to_batch((select batch_id from public.seals where seal_no = 240101), array[240106]) = 1, 'and it can be done a second time');
select test.ok((select batch_pos from public.seals where seal_no = 240106) = 6, 'each one lands after the last');
select test.fails($$select public.seal_add_to_batch((select batch_id from public.seals where seal_no = 240101), array[240104])$$, 'not_available:240104', 'a seal already out cannot be added');
select test.fails($$select public.seal_add_to_batch((select batch_id from public.seals where seal_no = 240101), array[181302])$$, '%', 'a seal of another roll is refused');
reset role;

-- ---------- The work statement of the technicians' seals ----------
select test.ok((select count(*) from public.seal_work_statement(null, null) where seal_no = 240101) = 1, 'the statement lists a used seal with its work');
select test.ok((select details from public.seal_work_statement(null, null) where seal_no = 240101) like '%طبلون 5%', 'with the line written for it');
select test.ok((select count(*) from public.seal_work_statement(date '2000-01-01', date '2000-01-02')) = 0, 'and only the days asked for');
reset role;

-- ---------- Independent statement permission: grant, read only, revoke ----------
reset role; select test.login('مسؤول النظام'); set role authenticated;
select public.admin_set_seals_access((select id from public.employees where full_name = 'موظف إداري'), false);
select public.admin_set_pages((select id from public.employees where full_name = 'موظف إداري'), array['seal-work', 'seal-work', 'bogus']);
select test.ok((select pages = array['seal-work'] from public.employees where full_name = 'موظف إداري'), 'the statement is saved as its own grantable page');
reset role; select test.login('موظف إداري'); set role authenticated;
select test.ok(public.has_page('seal-work') and not public.has_page('tasks') and not public.has_seals(), 'the statement permission does not open tasks or seals');
select test.ok((select count(*) from public.seal_work_statement(null, null) where seal_no = 240101) = 1, 'a statement-only reader can see the used seals');
select test.ok((select count(*) from public.seals) = 0, 'a statement-only reader cannot read the seals tables');
select test.fails($$select public.seal_record(240101, 'lost', null, null)$$, 'not_allowed', 'a statement-only reader cannot edit seals');
select test.fails($$select public.admin_set_pages(public.current_employee_id(), array['tasks'])$$, 'not_allowed', 'a statement reader cannot grant themselves another page');
reset role; select test.login('مسؤول النظام'); set role authenticated;
select public.admin_set_pages((select id from public.employees where full_name = 'موظف إداري'), array[]::text[]);
reset role; select test.login('موظف إداري'); set role authenticated;
select test.ok(not public.has_page('seal-work'), 'the statement permission can be switched off');
select test.fails($$select * from public.seal_work_statement(null, null)$$, 'not_allowed', 'revoking the page closes its data too');
reset role; select set_config('request.jwt.claims', '', false); set role anon;
select test.fails($$select * from public.seal_work_statement(null, null)$$, '%permission denied%', 'visitors cannot read the statement');
reset role;

-- ---------- Preparing a task from a phone call, before choosing the technician ----------
update public.employees set pages = array['tasks'] where full_name = 'موظف إداري';
select test.login('موظف إداري'); set role authenticated;
insert into public.tasks (task_type_id, assignee_id, expected_minutes, subscriber_name, subscriber_phone, location_text)
  values (2, null, 30, 'متصل تجريبي', '0591234567', 'قرب المسجد');
select test.ok((select count(*) from public.tasks where subscriber_name = 'متصل تجريبي' and assignee_id is null and status = 'new') = 1, 'someone with the tasks page prepares a task with no technician yet');
update public.tasks set assignee_id = (select id from public.employee_directory() where full_name = 'مجد عاشور') where subscriber_name = 'متصل تجريبي';
select test.ok((select assignee_id is not null and status = 'new' from public.tasks where subscriber_name = 'متصل تجريبي'), 'later it is given to a technician');
insert into public.outgoing_messages (task_id, channel, to_phone, body) select id, 'whatsapp', '0590000005', 'x' from public.tasks where subscriber_name = 'متصل تجريبي';
select test.ok((select status = 'sent' from public.tasks where subscriber_name = 'متصل تجريبي'), 'and sent to him');
reset role;

-- ---------- Extra load readings on a distribution run ----------
select test.ok((select count(*) from information_schema.columns where table_name = 'zone_runs' and column_name = 'load_extra') = 1, 'a run keeps extra load readings');
select test.fails($$insert into public.zone_runs (entry_id, run_no, load_extra) values (gen_random_uuid(), 1, array[-5])$$, '%', 'a negative extra reading is refused');

-- ---------- The subscribers' list for quick tasks ----------
select test.login('رامي أبو عجوة'); set role authenticated;
select test.ok(public.subscribers_import('[{"n":"محمد أحمد سالم","a":"الحملاوي","b":"12","p":"059-123-4567"},{"n":"x"}]'::jsonb) = 1, 'the manager loads the subscribers (bad lines are skipped)');
select test.ok((select phone from public.subscribers where full_name = 'محمد أحمد سالم') = '0591234567', 'the phone keeps only its digits');
reset role; select test.login('مشغّل الموقع'); set role authenticated;
select test.fails($$select public.subscribers_import('[]'::jsonb)$$, '%not_allowed%', 'only a manager replaces the list');
select test.ok((select count(*) from public.subscribers) = 0, 'and someone without the tasks page cannot read it');
reset role;

-- ---------- The office marks a task done for a technician without a smartphone ----------
select test.login('موظف إداري'); set role authenticated;
update public.tasks set status = 'done' where subscriber_name = 'متصل تجريبي';
select test.ok((select status = 'done' and completed_at is not null and started_at is not null from public.tasks where subscriber_name = 'متصل تجريبي'), 'the office marks a sent task done for the technician');
reset role;

-- ---------- Weekly meter readings ----------
select test.login('رامي أبو عجوة'); set role authenticated;
insert into public.reading_batches (id, title) values ('00000000-0000-0000-0000-0000000000f1', 'أسبوع تجريبي');
insert into public.reading_rows (id, batch_id, ord, sheet_row, code, area, board, subscriber, prev, mode) values
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f1', 1, 5, 'شقاقي 28_39', 'شقاقي', '28', 'مشترك أ', 120.7, 'paper');
update public.reading_rows set reading = 120.7 where id = '00000000-0000-0000-0000-0000000000f2';
select test.ok((select reading = 120.7 and source = 'paper' and entered_at is not null from public.reading_rows where id = '00000000-0000-0000-0000-0000000000f2'), 'a reading equal to the previous one is accepted, marked paper');
select test.fails($$update public.reading_rows set reading = 120.6 where id = '00000000-0000-0000-0000-0000000000f2'$$, '%check%', 'a reading below the previous one is refused');
update public.reading_rows set reading = 122.3 where id = '00000000-0000-0000-0000-0000000000f2';
select test.ok((select count(*) from public.reading_changes where row_id = '00000000-0000-0000-0000-0000000000f2') = 1, 'a correction is kept with the old and new value');
reset role; select test.login('مشغّل الموقع'); set role authenticated;
select test.ok((select count(*) from public.reading_rows) = 0, 'someone else sees no readings');
select test.ok(test.affected($$update public.reading_rows set reading = 999$$) = 0, 'and changes none');
reset role;

select test.login('رامي أبو عجوة'); set role authenticated;
update public.reading_rows set mode = 'app', assignee_id = (select id from public.employees where full_name = 'قصي الشافعي'), reading = null where id = '00000000-0000-0000-0000-0000000000f2';
reset role; select test.login('قصي الشافعي'); set role authenticated;
select test.ok((select count(*) from public.reading_batches) = 1, 'the reader sees the week he has subscribers in');
update public.reading_rows set reading = 125.4 where id = '00000000-0000-0000-0000-0000000000f2';
select test.ok((select reading = 125.4 and source = 'app' from public.reading_rows where id = '00000000-0000-0000-0000-0000000000f2'), 'the reader enters his reading');
select test.fails($$update public.reading_rows set prev = 1 where id = '00000000-0000-0000-0000-0000000000f2'$$, '%not_allowed%', 'the reader cannot change the previous reading');
reset role;

select test.login('رامي أبو عجوة'); set role authenticated;
insert into public.reading_files (id, batch_id, file_name, source_b64) values ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000f1', 'كشف 1.xlsx', 'AA==');
update public.reading_rows set file_id = '00000000-0000-0000-0000-0000000000f3', sheet = 'القراءات' where id = '00000000-0000-0000-0000-0000000000f2';
reset role; select test.login('قصي الشافعي'); set role authenticated;
select test.ok((select count(*) from public.reading_files) = 0, 'a reader does not see the uploaded files');
select test.fails($$update public.reading_rows set sheet = 'x' where id = '00000000-0000-0000-0000-0000000000f2'$$, '%not_allowed%', 'the reader cannot move his row to another sheet');
reset role; select test.login('رامي أبو عجوة'); set role authenticated;
delete from public.reading_files where id = '00000000-0000-0000-0000-0000000000f3';
select test.ok((select count(*) from public.reading_rows where id = '00000000-0000-0000-0000-0000000000f2') = 0, 'removing a file removes its subscribers');
reset role;

-- ---------- SMS from the company's subscription ----------
select test.login('مشغّل الموقع'); set role authenticated;
select test.fails($$select public.sms_send(array['0599000001'], 'x')$$, '%not_allowed%', 'only a manager sends from the company subscription');
select test.fails($$select public.sms_set_login('a', 'b', 'c')$$, '%not_allowed%', 'only a manager saves the SMS login');
reset role; select test.login('رامي أبو عجوة'); set role authenticated;
select test.ok((select (public.sms_info()->>'ready')::boolean = false), 'no SMS login yet');
select test.ok((select (public.sms_send(array['0599000001', '123'], 'مهمة 1', null)->>'sent')::int = 0), 'without a login nothing is sent');
select test.ok((select count(*) from public.outgoing_messages where provider = 'hotsms' and status = 'failed') = 1, 'the failed send is logged (a bad number is not)');
select test.fails($$select public.sms_send(array['0599000001','0599000002','0599000003','0599000004','0599000005','0599000006'], 'x')$$, '%bad_count%', 'at most five numbers per call');
select public.sms_set_login('user', 'pass', '');
select test.ok((select (public.sms_info()->>'ready')::boolean and public.sms_info()->>'sender' = 'AF Camp2'), 'the login is saved, with the default sender');
select test.fails($$select user_pass from m2_ops.sms_config$$, '%permission denied%', 'the app cannot read the SMS password');
reset role;

-- ---------- Immutable operation references and scoped live activity ----------
reset role; select test.login('رامي أبو عجوة'); set role authenticated;
select public.seal_add_roll(990001,990005,public.seal_today(),'activity test');
select test.ok((select count(*)=1 from public.seal_activity('seal_rolls', (select id::text from public.seal_rolls where from_no=990001), null,null) where text like '%أضاف رول%' and who='رامي أبو عجوة'), 'new seal rolls have an actor and immutable operation reference');
select test.ok((select count(*)>0 from public.recent_activity(200) where kind='seal' and text like '%990001%'), 'seal work appears in the manager activity feed');
select public.seal_issue((select id from public.employees where full_name='قصي الشافعي'),public.seal_today(),array[990001],null);
select test.ok((select count(*)=0 from public.recent_activity(200) where text like 'صرف الختم 990001%'), 'issuing one batch does not duplicate its notification for every seal');
select public.seal_record(990001,'used',public.seal_today(),'تفتيش (مشترك افتراضي)');
select test.ok((select count(*)=1 from public.recent_activity(200) where text like 'سجّل استخدام الختم 990001%'), 'recorded seal work is a live activity');
select public.seal_record(990001,'issued',null,'');
select public.seal_unissue(array[990001]);
select test.ok((select count(*)=1 from public.recent_activity(200) where text like 'أعاد للمخزن الختم 990001%'), 'returning a seal remains visible in activity');
select test.ok((select bool_and(not (to_jsonb(a) ? 'old_row') and not (to_jsonb(a) ? 'new_row')) from public.recent_activity(200) a), 'activity RPC never exposes private row snapshots');
select test.fails($$select * from public.seal_activity('employees',null,null,null)$$,'%not_allowed%','seal history cannot expose employee history');
select test.ok((select count(*)=0 from public.seal_activity('seal_rolls','nonexistent',null,null)), 'record history is scoped to the requested record');
reset role;
select test.ok((select count(*)=1 from public.audit_log where table_name='seal_rolls' and new_row->>'from_no'='990001'), 'adding a roll does not audit each blank seal');
update public.employees set can_seals=true where full_name='موظف إداري';
select test.login('موظف إداري'); set role authenticated;
select public.seal_add_roll(991001,991005,public.seal_today(),'accountant operation');
select test.ok((select count(*)=1 from public.seal_activity(null,null,public.current_employee_id(),null) where text like '%991001%' and who='موظف إداري'), 'an accountant can retrieve their attributed operations');
select test.fails($$select * from public.recent_activity(10)$$,'%not_allowed%','accountants cannot retrieve the manager system feed');
select test.ok((select count(*)=0 from public.seal_activity(null,null,null,0)), 'history pagination respects its reference cursor');
reset role;
update public.seal_rolls set note='changed' where from_no=991001;
select test.ok((select count(*)=2 from public.audit_log where table_name='seal_rolls' and coalesce(new_row,old_row)->>'from_no'='991001'), 'an edit keeps the original insert reference');
delete from public.seal_rolls where from_no=991001;
select test.login('رامي أبو عجوة'); set role authenticated;
select test.ok((select count(*)=3 from public.seal_activity(null,null,null,null) where table_name='seal_rolls' and text like '%991001%'), 'history survives deletion of the seal roll');
reset role; select test.login('مشغّل الموقع'); set role authenticated;
select test.fails($$select * from public.seal_activity()$$,'%not_allowed%','staff without seals permission cannot read seal history');
reset role; set role anon;
select test.fails($$select * from public.recent_activity()$$,'%permission denied%','visitors cannot read the activity feed');
select test.fails($$select * from public.seal_activity()$$,'%permission denied%','visitors cannot read seal history');
reset role;

-- ---------- Confirmation-only cancellation, with the same access rules and history ----------
reset role; select test.login('موظف إداري'); set role authenticated;
with t as (
 insert into public.tasks (task_type_id,assignee_id,expected_minutes,subscriber_name)
 values (2,null,30,'فحص إلغاء طلب مجهّز') returning id)
insert into test.ids select 'cancel_prepared',id from t;
update public.tasks set status='cancelled',cancel_reason='   ' where id=(select v from test.ids where k='cancel_prepared');
select test.ok((select status='cancelled' and cancelled_at is not null and cancel_reason is null from public.tasks where id=(select v from test.ids where k='cancel_prepared')), 'the task office cancels an unassigned request without inventing a reason');
select test.ok((select count(*)=1 from public.task_events where task_id=(select v from test.ids where k='cancel_prepared') and event='cancelled' and actor_id=public.current_employee_id()), 'a reasonless cancellation retains its actor and event');
update public.tasks set status='cancelled' where id=(select v from test.ids where k='cancel_prepared');
select test.ok((select count(*)=1 from public.task_events where task_id=(select v from test.ids where k='cancel_prepared') and event='cancelled'), 'replaying a cancellation does not duplicate the event');
with t as (
 insert into public.tasks (task_type_id,assignee_id,expected_minutes)
 values (2,(select id from public.employee_directory() where full_name='قصي الشافعي'),30) returning id)
insert into test.ids select 'cancel_assigned',id from t;
reset role; select test.login('قصي الشافعي'); set role authenticated;
select test.fails($$update public.tasks set status='cancelled' where id=(select v from test.ids where k='cancel_assigned')$$,'%Invalid task step%','removing the reason requirement does not let a technician cancel their task');
reset role; select test.login('موظف إداري'); set role authenticated;
update public.tasks set status='cancelled' where id=(select v from test.ids where k='cancel_assigned');
select test.ok((select status='cancelled' and cancelled_at is not null and cancel_reason is null from public.tasks where id=(select v from test.ids where k='cancel_assigned')), 'the task office also cancels an assigned task without a reason');
select test.fails($$update public.tasks set status='cancelled' where status='done'$$,'%can send or cancel%','a completed task still cannot be cancelled');
reset role;

-- ---------- Bounded private client diagnostics ----------
reset role; set role anon;
select test.fails($$select public.report_client_issue(gen_random_uuid(),'render','Error','/tasks','','test')$$,'%permission denied%','visitors cannot upload client diagnostics');
select test.fails($$select * from public.recent_client_issues()$$,'%permission denied%','visitors cannot see client diagnostics');
reset role; select test.login('موظف إداري');set role authenticated;
select public.report_client_issue('00000000-0000-0000-0000-00000000ce01','render','TypeError','/tasks','/assets/index-test.js:1:2','test');
select public.report_client_issue('00000000-0000-0000-0000-00000000ce01','render','TypeError','/tasks','/assets/index-test.js:1:2','test');
select test.fails($$select * from public.client_issues$$,'%permission denied%','staff cannot read raw diagnostic rows');
select test.fails($$select * from public.recent_client_issues()$$,'%not_allowed%','staff cannot read other employees diagnostics');
select test.fails($$select public.report_client_issue(gen_random_uuid(),'render','Error','/t/private?token=x','','test')$$,'%check%','diagnostic routes cannot contain query parameters');
select test.fails($$select public.report_client_issue(gen_random_uuid(),'render','Error','/tasks','private text','test')$$,'%invalid_diagnostic%','arbitrary private error text is rejected');
reset role;select test.login('رامي أبو عجوة');set role authenticated;
select test.ok((select count(*)=1 from public.recent_client_issues() where id='00000000-0000-0000-0000-00000000ce01' and who='موظف إداري'),'manager sees a deduplicated error with its real actor');
reset role;
select test.ok((select count(*)=1 from public.client_issues),'retries create only one diagnostic record');
insert into public.client_issues(id,employee_id,at,kind,code,route,location,build) values(gen_random_uuid(),(select id from public.employees where full_name='موظف إداري'),now()-interval '31 days','render','Error','/tasks','','test');
select test.login('موظف إداري');set role authenticated;
select public.report_client_issue(gen_random_uuid(),'promise','Error','/account','','test');
reset role;
select test.ok(not exists(select 1 from public.client_issues where at<now()-interval '30 days'),'older diagnostics are pruned on the next report');
select test.login('موظف إداري');set role authenticated;
select public.report_client_issue(gen_random_uuid(),'error','Error','/tasks','','test') from generate_series(1,8);
select test.fails($$select public.report_client_issue(gen_random_uuid(),'error','Error','/tasks','','test')$$,'%rate_limit%','diagnostic flood is limited to ten per employee per hour');
reset role;

-- ---------- Second audit batch: directory, provider hook and explicitly confirmed archives ----------
reset role;
create temp table second_test as select id as tech from public.employees where role='technician' and auth_user_id is not null and is_active limit 1;
grant select on second_test to authenticated;
update public.employees set pages='{}',can_seals=false where id=(select tech from second_test);
select test.login((select full_name from public.employees where id=(select tech from second_test)));set role authenticated;
select test.ok((select count(*)=1 from public.employees),'a technician reads only their own full employee record');
select test.ok((select count(*)=1 from public.employee_directory()),'plain technician directory is limited to self');
select test.fails($$select public.storage_overview()$$,'%not_allowed%','technician cannot read storage/admin archive metadata');
select test.fails($$select public.prepare_cold_archive('audit')$$,'%not_allowed%','technician cannot export old audit rows');
select test.fails($$select public.finish_cold_archive(gen_random_uuid())$$,'%not_allowed%','technician cannot purge archive records');
select test.fails($$select public.restore_reading_archive('{}')$$,'%not_allowed%','technician cannot restore/overwrite reading sources');
select test.fails($$select public.password_verification_attempt_hook('{}')$$,'%permission denied%','a logged-in client cannot invoke the password hook');
reset role;
update public.employees set pages=array['tasks'] where full_name='موظف إداري';
select test.login('موظف إداري');set role authenticated;
select test.ok(exists(select 1 from public.employee_directory() where role='technician' and phone is not null),'task dispatcher receives technician contacts through the restricted directory');
select test.ok(not exists(select 1 from public.employee_directory() where id<>public.current_employee_id() and auth_user_id is not null),'directory hides other auth identities from the dispatcher');
reset role;
update public.employees set pages=array['seal-work'],can_seals=true where full_name='موظف إداري';
select test.login('موظف إداري');set role authenticated;
select test.ok(exists(select 1 from public.employee_directory() where role='technician'),'seal staff still have technician names');
select test.ok(not exists(select 1 from public.employee_directory() where id<>public.current_employee_id() and phone is not null),'seal staff cannot enumerate coworkers phones');
reset role;
-- Call as the function owner: never expose the hook as an app RPC.
select public.password_verification_attempt_hook(jsonb_build_object('user_id',(select auth_user_id from public.employees where id=(select tech from second_test)),'valid',false)) from generate_series(1,5);
select test.ok((select public.password_verification_attempt_hook(jsonb_build_object('user_id',auth_user_id,'valid',true))->>'decision'='reject' from public.employees where id=(select tech from second_test)),'five failed attempts block even a correct password temporarily');
select test.ok((select public.password_verification_attempt_hook(jsonb_build_object('user_id',auth_user_id,'valid',true))->>'should_logout_user'='false' from public.employees where id=(select tech from second_test)),'login throttling does not sign out active sessions');
update m2_ops.login_attempts set blocked_until=now()-interval '1 minute',started_at=now()-interval '16 minutes';
select test.ok((select public.password_verification_attempt_hook(jsonb_build_object('user_id',auth_user_id,'valid',true))->>'decision'='continue' from public.employees where id=(select tech from second_test)),'correct password works again after lock expires');
select test.ok(not exists(select 1 from m2_ops.login_attempts),'successful verification clears past failures');

insert into public.audit_log(table_name,record_id,action,at,new_row) values('tasks','second-old-audit','update',now()-interval '2 years','{"number":90001,"status":"done","link_token":"must-not-export","subscriber_name":"مشترك تجريبي"}'),('tasks','second-recent-audit','update',now(),'{}');
create temp table archive_test(kind text primary key,archive jsonb);
grant all on archive_test to authenticated;
select test.login((select full_name from public.employees where role='manager' and is_active limit 1));set role authenticated;
insert into archive_test values('audit',public.prepare_cold_archive('audit'));
select test.ok(exists(select 1 from public.audit_log where record_id='second-old-audit'),'preparing/downloading an archive never deletes its source');
select test.ok(not (select archive::text like '%must-not-export%' from archive_test where kind='audit'),'archive strips task link credentials');
select public.finish_cold_archive((select (archive->>'receipt')::uuid from archive_test where kind='audit'));
select test.ok(not exists(select 1 from public.audit_log where record_id='second-old-audit'),'confirmed archive deletes exactly the exported old records');
select test.ok(exists(select 1 from public.audit_log where record_id='second-recent-audit'),'cleanup preserves recent audit history');
select test.fails($$select public.finish_cold_archive((select (archive->>'receipt')::uuid from archive_test where kind='audit'))$$,'%archive_expired%','cleanup receipt cannot be replayed');
reset role;
insert into public.reading_batches(id,title,period_from,period_to,status,source_b64) values('00000000-0000-0000-0000-0000000038b1','أسبوع أرشيف تجريبي',current_date-740,current_date-733,'approved','bGVnYWN5');
insert into public.reading_files(id,batch_id,file_name,source_b64) values('00000000-0000-0000-0000-0000000038f1','00000000-0000-0000-0000-0000000038b1','تجريبي.xlsx','ZmFrZS1leGNlbA==');
insert into public.reading_rows(batch_id,file_id,ord,sheet_row,subscriber,prev,reading) values('00000000-0000-0000-0000-0000000038b1','00000000-0000-0000-0000-0000000038f1',1,1,'مشترك وهمي',10,15);
select test.login((select full_name from public.employees where role='manager' and is_active limit 1));set role authenticated;
insert into archive_test values('reading',public.prepare_cold_archive('reading','00000000-0000-0000-0000-0000000038b1'));
select test.ok((select source_b64='ZmFrZS1leGNlbA==' from public.reading_files where id='00000000-0000-0000-0000-0000000038f1'),'preparing the reading archive preserves the original XLSX');
select public.finish_cold_archive((select (archive->>'receipt')::uuid from archive_test where kind='reading'));
select test.ok((select source_b64='' and archived_at is not null from public.reading_files where id='00000000-0000-0000-0000-0000000038f1'),'confirmed archive frees source bytes but retains file identity');
select test.ok((select count(*)=1 from public.reading_rows where batch_id='00000000-0000-0000-0000-0000000038b1' and reading=15),'archiving never deletes subscriber readings');
select test.fails($$select public.restore_reading_archive(jsonb_set((select archive from archive_test where kind='reading'),'{data,files,0,source_b64}','"tampered"'))$$,'%invalid_archive%','tampered restore is rejected atomically');
select public.restore_reading_archive((select archive from archive_test where kind='reading'));
select test.ok((select source_b64='ZmFrZS1leGNlbA==' and archived_at is null from public.reading_files where id='00000000-0000-0000-0000-0000000038f1'),'restoring archive restores exact original XLSX');
select test.ok((select source_b64='bGVnYWN5' and archived_at is null from public.reading_batches where id='00000000-0000-0000-0000-0000000038b1'),'legacy single-file sources also round-trip');
reset role;select set_config('request.jwt.claims','',false);set role anon;
select test.fails($$select * from public.employee_directory()$$,'%permission denied%','anonymous users cannot query the staff directory');
select test.fails($$select public.password_verification_attempt_hook('{}')$$,'%permission denied%','anonymous users cannot reset/poison the password verification ledger');
select test.fails($$select public.prepare_cold_archive('audit')$$,'%permission denied%','anonymous users cannot export history');
reset role;


-- Changing a reading after download invalidates the cleanup receipt, without losing the source.
select test.login((select full_name from public.employees where role='manager' and is_active limit 1));set role authenticated;
update archive_test set archive=public.prepare_cold_archive('reading','00000000-0000-0000-0000-0000000038b1') where kind='reading';
update public.reading_rows set reading=16 where batch_id='00000000-0000-0000-0000-0000000038b1';
select test.fails($$select public.finish_cold_archive((select (archive->>'receipt')::uuid from archive_test where kind='reading'))$$,'%archive_changed%','a stale archive cannot clean up data changed after download');
select test.ok((select source_b64='ZmFrZS1leGNlbA==' from public.reading_files where id='00000000-0000-0000-0000-0000000038f1'),'a stale archive leaves original sources untouched');
select test.ok(not exists(select 1 from public.audit_log where table_name='reading_batches' and ((old_row ? 'source_b64') or (new_row ? 'source_b64'))),'workbook bodies are not multiplied in new change snapshots');
select test.ok(not exists(select 1 from public.audit_log where (old_row ? 'link_token') or (new_row ? 'link_token')),'new audit snapshots omit task link credentials');
reset role;
insert into public.reading_batches(id,title,period_to,status) values('00000000-0000-0000-0000-0000000038b2','حديث',current_date,'approved'),('00000000-0000-0000-0000-0000000038b3','مفتوح قديم',current_date-800,'open');
select test.login((select full_name from public.employees where role='manager' and is_active limit 1));set role authenticated;
select test.fails($$select public.prepare_cold_archive('reading','00000000-0000-0000-0000-0000000038b2')$$,'%archive_not_allowed%','current reading weeks cannot be archived');
select test.fails($$select public.prepare_cold_archive('reading','00000000-0000-0000-0000-0000000038b3')$$,'%archive_not_allowed%','even old open reading weeks cannot be archived');
reset role;

-- Minimal directory projections preserve each explicitly granted office workflow.
update public.employees set pages=array['reports'],can_seals=false where full_name='موظف إداري';
select test.login('موظف إداري');set role authenticated;
select test.ok(exists(select 1 from public.employee_directory() where id<>public.current_employee_id() and tracks_attendance),'reports permission retains attendance fields needed by its summaries');
select test.ok(not exists(select 1 from public.employee_directory() where id<>public.current_employee_id() and phone is not null),'reports permission does not expose coworkers phones');
reset role;
update public.employees set pages=array['readings'] where id=(select tech from second_test);
update public.employees set pages=array['readings-admin'] where full_name='موظف إداري';
select test.login('موظف إداري');set role authenticated;
select test.ok(exists(select 1 from public.employee_directory() where id=(select tech from second_test) and 'readings'=any(pages)),'reading admin still sees whether a technician can use readings');
select test.ok(not exists(select 1 from public.employee_directory() where id<>public.current_employee_id() and phone is not null),'reading admin receives no unnecessary phone numbers');
reset role;
-- ---------- QR attendance only from the office network ----------
reset role; select test.login('رامي أبو عجوة'); set role authenticated;
select test.ok(public.client_ip() is null, 'no address without a web request');
select set_config('request.headers', '{"cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1, 10.0.0.1"}', false);
select test.ok(public.client_ip() = '203.0.113.7', 'the edge header gives the address');
select test.ok((public.attendance_office_network_add((select min(id) from public.attendance_points))->>'ip') = '203.0.113.7', 'the manager approves the network he sits on');
select test.ok((select allowed_ips = array['203.0.113.7'] from public.attendance_points order by id limit 1), 'the address is kept');
select public.attendance_office_network_add((select min(id) from public.attendance_points));
select test.ok((select cardinality(allowed_ips) = 1 from public.attendance_points order by id limit 1), 'approving twice does not duplicate it');
reset role; select test.login('مشغّل الموقع'); set role authenticated;
select test.fails($$select public.attendance_office_network_add((select min(id) from public.attendance_points))$$, '%not_allowed%', 'only a manager approves a network');
select test.fails($$select public.admin_set_punch_anywhere(public.current_employee_id(), true)$$, '%not_allowed%', 'only a manager lets someone scan from anywhere');
reset role;
-- ---------- Shared task ownership, subscription messages and selected-day statements ----------
reset role;
create temp table shared_sms_original as select pg_get_functiondef('m2_ops.hotsms(text,jsonb)'::regprocedure) definition;
create table test.shared_sms_calls(mobile text,body text);
create table test.shared_sms_control(fail_mobile text);
insert into test.shared_sms_control values(null);
grant all on test.shared_sms_calls,test.shared_sms_control to authenticated;
create or replace function m2_ops.hotsms(p_page text,p_params jsonb) returns text language plpgsql security definer set search_path=public as $$
begin
 insert into test.shared_sms_calls values(p_params->>'mobile',p_params->>'text');
 if exists(select 1 from test.shared_sms_control where fail_mobile=p_params->>'mobile') then return '10000';end if;
 return '1001';
end $$;
insert into test.ids values('joint_a',(select id from public.employees where role='technician' and auth_user_id is not null and is_active order by id limit 1));
insert into test.ids values('joint_b',(select id from public.employees where role='technician' and auth_user_id is not null and is_active and id<>(select v from test.ids where k='joint_a') order by id limit 1));
update public.employees set pages=array['tasks'] where full_name='موظف إداري';
select test.login('موظف إداري');set role authenticated;
with x as(insert into public.tasks(task_type_id,assignee_id,assignee_ids,subscriber_name,details,expected_minutes) values(2,(select v from test.ids where k='joint_a'),array[(select v from test.ids where k='joint_a'),(select v from test.ids where k='joint_b')],'مشترك مشتركة وهمي','تركيب تجريبي مشترك',30) returning id) insert into test.ids select 'joint_task',id from x;
select test.ok((select cardinality(assignee_ids)=2 and assignee_id=assignee_ids[1] from public.tasks where id=(select v from test.ids where k='joint_task')),'one shared order keeps both technicians with a compatible primary');
select test.fails($$insert into public.tasks(task_type_id,assignee_ids,expected_minutes) values(2,array[gen_random_uuid()],30)$$,'%invalid_technician%','shared assignment rejects unknown technicians');
select test.fails($$insert into public.tasks(task_type_id,assignee_ids,expected_minutes) values(2,array[public.current_employee_id()],30)$$,'%invalid_technician%','a staff account cannot be added as a technician');
select test.ok(public.task_sms_units(public.shared_task_sms_text((select v from test.ids where k='joint_task')))<=70,'shared SMS fits one Unicode segment');
select test.ok(public.task_sms_units('😀')=2 and public.task_sms_units(public.task_sms_trim(repeat('😀',50)))=70,'SMS billing length handles non-BMP Unicode without cutting a character');
reset role;select test.login((select full_name from public.employees where id=(select v from test.ids where k='joint_b')));set role authenticated;
select test.ok(exists(select 1 from public.tasks where id=(select v from test.ids where k='joint_task')),'secondary technician can read their shared order');
select test.fails($$update public.tasks set status='done' where id=(select v from test.ids where k='joint_task')$$,'%office_completes_shared%','a technician cannot complete the shared order');
select test.fails($$update public.tasks set status='in_progress' where id=(select v from test.ids where k='joint_task')$$,'%office_completes_shared%','a technician cannot start or claim the shared order');
select test.fails($$select public.task_send_shared_sms((select v from test.ids where k='joint_task'),gen_random_uuid(),array[(select v from test.ids where k='joint_a'),(select v from test.ids where k='joint_b')])$$,'%not_allowed%','technician cannot spend the company SMS balance');
reset role;
create temp table shared_link as select link_token from public.tasks where id=(select v from test.ids where k='joint_task');grant select on shared_link to anon;
select set_config('request.jwt.claims','',false);set role anon;
select test.ok((public.task_link_view((select link_token from shared_link))->>'shared')::boolean,'private shared link is a read-only shared order');
select test.fails($$select public.task_link_act((select link_token from shared_link),'done')$$,'%office_completes_shared%','private link cannot bypass office-only shared completion');
select test.fails($$select * from public.task_search('مشتركة')$$,'%permission denied%','anonymous visitors cannot search tasks');
select test.fails($$select * from public.tasks_for_day(current_date)$$,'%permission denied%','anonymous visitors cannot enumerate day statements');
reset role;select test.login('موظف إداري');set role authenticated;
update test.shared_sms_control set fail_mobile=(select '972'||substr(phone,2) from public.employee_directory() where id=(select v from test.ids where k='joint_b'));
create temp table shared_results(k text primary key,value jsonb);
insert into shared_results values('first',public.task_send_shared_sms((select v from test.ids where k='joint_task'),'00000000-0000-0000-0000-000000003901',array[(select v from test.ids where k='joint_a'),(select v from test.ids where k='joint_b')]));
select test.ok((select (value->>'sent')::int=1 and jsonb_array_length(value->'failed')=1 from shared_results where k='first'),'one provider refusal is reported without claiming success for everyone');
select test.ok((select count(*)=2 and count(distinct body)=1 from test.shared_sms_calls),'one send action delivers the same message to each selected technician');
select public.task_send_shared_sms((select v from test.ids where k='joint_task'),'00000000-0000-0000-0000-000000003901',array[(select v from test.ids where k='joint_a'),(select v from test.ids where k='joint_b')]);
select test.ok((select count(*)=2 from test.shared_sms_calls),'network retry of a committed request makes no extra paid calls');
update test.shared_sms_control set fail_mobile=null;
insert into shared_results values('retry',public.task_send_shared_sms((select v from test.ids where k='joint_task'),'00000000-0000-0000-0000-000000003902',array[(select v from test.ids where k='joint_a'),(select v from test.ids where k='joint_b')]));
select test.ok((select (value->>'sent')::int=1 and (value->>'already')::int=1 and jsonb_array_length(value->'failed')=0 from shared_results where k='retry'),'retry sends only to the recipient whose SMS failed');
select test.ok((select count(*)=3 from test.shared_sms_calls),'successful recipient is not charged a second SMS on retry');
select test.fails($$select public.task_send_shared_sms((select v from test.ids where k='joint_task'),gen_random_uuid(),array[(select v from test.ids where k='joint_a')])$$,'%assignment_changed%','stale or forged recipient list is rejected before sending');
select test.ok((select count(*)=3 from test.shared_sms_calls),'invalid recipient selection causes no provider call');
select test.ok(exists(select 1 from public.task_search('مشترك مشتركة وهمي') where id=(select v from test.ids where k='joint_task')),'general task search finds a shared subscriber across states');
select test.ok(exists(select 1 from public.task_search((select full_name from public.employee_directory() where id=(select v from test.ids where k='joint_b'))) where id=(select v from test.ids where k='joint_task')),'search matches a secondary technician name');
select test.ok(public.task_search_fold('أَحْمَد ١٢۳')='احمد 123','server search folds Arabic spelling and both digit alphabets');
update public.tasks set status='done' where id=(select v from test.ids where k='joint_task');
select test.ok((select status='done' and completed_at is not null from public.tasks where id=(select v from test.ids where k='joint_task')),'office Done completes the shared order once for all members');
select test.ok((select count(*)=1 from public.task_events where task_id=(select v from test.ids where k='joint_task') and event='completed'),'shared completion has exactly one completion event');
select test.fails($$select public.task_send_shared_sms((select v from test.ids where k='joint_task'),gen_random_uuid(),array[(select v from test.ids where k='joint_a'),(select v from test.ids where k='joint_b')])$$,'%task_closed%','closed shared work cannot trigger a new SMS');
with x as(insert into public.tasks(task_type_id,assignee_id,expected_minutes,subscriber_name,created_at) values(2,(select v from test.ids where k='joint_a'),30,'مشترك أمس التجريبي',now()-interval '2 days') returning id) insert into test.ids select 'joint_yesterday',id from x;
update public.tasks set status='done',recorded_offline=true,device_time=(((now() at time zone 'Asia/Gaza')::date-1)::text||' 12:00:00')::timestamp at time zone 'Asia/Gaza' where id=(select v from test.ids where k='joint_yesterday');
select test.ok(exists(select 1 from public.tasks_for_day((now() at time zone 'Asia/Gaza')::date-1) where id=(select v from test.ids where k='joint_yesterday')),'selected yesterday statement includes yesterday completion');
select test.ok(not exists(select 1 from public.tasks_for_day((now() at time zone 'Asia/Gaza')::date-1) where id=(select v from test.ids where k='joint_task')),'selected yesterday statement excludes today shared order');
select test.ok(not exists(select 1 from public.tasks_for_day((now() at time zone 'Asia/Gaza')::date) where id=(select v from test.ids where k='joint_yesterday')),'today statement does not mix in an older completion');
reset role;select test.login((select full_name from public.employees where id=(select v from test.ids where k='joint_b')));set role authenticated;
select test.ok(exists(select 1 from public.tasks where id=(select v from test.ids where k='joint_task') and status='done'),'secondary participant sees the same completed shared order');
select test.ok(not exists(select 1 from public.task_events where task_id=(select v from test.ids where k='joint_task')),'shared technicians cannot enumerate peers phones through SMS event metadata');
select test.ok(not exists(select 1 from public.task_search('مشترك أمس التجريبي') where id=(select v from test.ids where k='joint_yesterday')),'general search preserves row security for unassigned work');
reset role;
do $$ declare original text;begin select definition into original from shared_sms_original;execute original;end $$;

\echo 'ALL CHECKS PASSED'
