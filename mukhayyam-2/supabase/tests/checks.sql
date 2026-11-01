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
select test.ok((select count(*) from public.zones) = 6 and (select count(*) from public.task_types) = 10, 'seed: 6 zones and 10 task types');

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
select test.fails($$update public.tasks set status = 'cancelled' where status = 'new'$$, '%needs a reason%', 'cancelling needs a reason');
update public.tasks set status = 'cancelled', cancel_reason = 'المشترك غير موجود' where status = 'new';
select test.ok((select count(*) from public.tasks where status = 'cancelled' and cancelled_at is not null) = 1, 'the manager cancels with a reason');
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
update public.attendance_punches set at = at - interval '3 hours';
select set_config('request.jwt.claims', '', false); set role anon;
select test.ok(jsonb_array_length(public.attendance_punch((select code from test.point), (select token from test.dev)) -> 'punches') = 2, 'the next scan is "out"');
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

\echo 'ALL CHECKS PASSED'
