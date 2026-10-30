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
select test.fails($$update public.site_reports set status = 'draft' where report_date = '2026-10-29'$$, '%only approve or return%', 'an approved report stays approved');
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
select test.ok((select count(*) from public.distribution_sheets) = 0, 'the generation operator cannot see the distribution sheet');

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

-- ---------- People and logins ----------
select test.fails($$select public.admin_save_employee(null, 'زيد', 'technician', '0591111111', '123456', true, true)$$,
                  'not_allowed', 'only the admin adds people');
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

-- ---------- Not signed in ----------
reset role; select set_config('request.jwt.claims', '', false); set role anon;
select test.fails($$select count(*) from public.employees$$, '%permission denied%', 'nothing is readable without signing in');
select test.fails($$select public.setup_first_admin('دخيل', '0592222222', '123456')$$, 'already_set_up',
                  'nobody can claim the first admin once it exists');
reset role;

\echo 'ALL CHECKS PASSED'
