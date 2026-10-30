-- Mukhayyam 2: who may see and change what, server-side times, and change history.

-- ---------- Identity helpers ----------
create function public.current_employee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.employees where auth_user_id = auth.uid() and is_active limit 1
$$;

create function public.current_user_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.employees where auth_user_id = auth.uid() and is_active limit 1
$$;

create function public.has_role(variadic roles public.user_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_user_role() = any (roles), false)
$$;

create function public.is_manager() returns boolean
language sql stable as $$
  select public.has_role('admin', 'manager')
$$;

-- The app measures the gap between the phone clock and this, so times stay correct offline.
create function public.server_now() returns timestamptz
language sql stable as $$
  select now()
$$;

-- When an action happened without internet, trust the phone time only within sane bounds.
create function public.event_time(p_offline boolean, p_device_time timestamptz, p_not_before timestamptz)
returns timestamptz language sql stable as $$
  select case
    when p_offline and p_device_time is not null
      then greatest(least(p_device_time, now()), coalesce(p_not_before, '-infinity'::timestamptz), now() - interval '7 days')
    else now()
  end
$$;

-- ---------- Report and sheet workflow: draft -> submitted -> approved (or returned -> submitted) ----------
-- TG_ARGV[0] is the role that fills the sheet (generation_operator or distribution_supervisor).
create function public.sheet_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.user_role := public.current_user_role();
  me uuid := public.current_employee_id();
  filler public.user_role := tg_argv[0]::public.user_role;
begin
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'submitted') then
      raise exception 'A new sheet starts as draft or submitted';
    end if;
    new.created_by := coalesce(me, new.created_by);
    new.submitted_by := null; new.submitted_at := null;
    new.approved_by := null; new.approved_at := null;
    if new.status = 'submitted' then
      new.submitted_by := me;
      new.submitted_at := public.event_time(new.recorded_offline, new.device_time, null);
    end if;
    return new;
  end if;

  if r = filler and old.status in ('submitted', 'approved') then
    raise exception 'This sheet was sent and can no longer be edited by site staff';
  end if;

  if new.status is distinct from old.status then
    if r = filler and not (old.status in ('draft', 'returned') and new.status = 'submitted') then
      raise exception 'Site staff can only send a draft or returned sheet';
    end if;
    if r = 'manager' and not (old.status = 'submitted' and new.status in ('approved', 'returned')) then
      raise exception 'The manager can only approve or return a sent sheet';
    end if;
    if r is distinct from filler and r not in ('manager', 'admin') then
      raise exception 'Not allowed';
    end if;
    if new.status = 'submitted' then
      new.submitted_by := me;
      new.submitted_at := public.event_time(new.recorded_offline, new.device_time, old.created_at);
      new.returned_reason := null;
    elsif new.status = 'approved' then
      new.approved_by := me;
      new.approved_at := now();
    elsif new.status = 'returned' then
      if length(btrim(coalesce(new.returned_reason, ''))) = 0 then
        raise exception 'Returning a sheet needs a reason';
      end if;
      new.approved_by := null; new.approved_at := null;
    end if;
  else
    -- Server-owned columns cannot be changed by hand.
    new.submitted_by := old.submitted_by; new.submitted_at := old.submitted_at;
    new.approved_by := old.approved_by; new.approved_at := old.approved_at;
  end if;
  new.created_by := old.created_by;
  return new;
end $$;

create trigger site_reports_guard before insert or update on public.site_reports
  for each row execute function public.sheet_guard('generation_operator');
create trigger distribution_sheets_guard before insert or update on public.distribution_sheets
  for each row execute function public.sheet_guard('distribution_supervisor');

create function public.site_report_editable(p_report_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager() or (
    public.has_role('generation_operator')
    and exists (select 1 from public.site_reports where id = p_report_id and status in ('draft', 'returned'))
  )
$$;

create function public.generator_log_editable(p_log_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.site_report_editable((select report_id from public.generator_day_logs where id = p_log_id))
$$;

create function public.distribution_sheet_editable(p_sheet_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager() or (
    public.has_role('distribution_supervisor')
    and exists (select 1 from public.distribution_sheets where id = p_sheet_id and status in ('draft', 'returned'))
  )
$$;

create function public.zone_entry_editable(p_entry_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.distribution_sheet_editable((select sheet_id from public.zone_day_entries where id = p_entry_id))
$$;

-- ---------- Task lifecycle ----------
create function public.tasks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.current_employee_id();
  mgr boolean := public.is_manager();
  t timestamptz;
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(me, new.created_by);
    new.status := 'new';
    new.sent_at := null; new.seen_at := null; new.started_at := null;
    new.completed_at := null; new.cancelled_at := null;
    return new;
  end if;

  if not mgr then
    if old.assignee_id is distinct from me then
      raise exception 'This task is not assigned to you';
    end if;
    if (new.task_type_id, new.assignee_id, new.details, new.subscriber_name, new.subscriber_phone,
        new.zone_id, new.location_text, new.priority, new.expected_minutes, new.created_by, new.cancel_reason)
       is distinct from
       (old.task_type_id, old.assignee_id, old.details, old.subscriber_name, old.subscriber_phone,
        old.zone_id, old.location_text, old.priority, old.expected_minutes, old.created_by, old.cancel_reason) then
      raise exception 'A technician can only start, finish and add notes to a task';
    end if;
    if new.status is distinct from old.status and not (
         (old.status in ('new', 'sent') and new.status = 'seen')
      or (old.status in ('new', 'sent', 'seen') and new.status = 'in_progress')
      or (old.status = 'in_progress' and new.status = 'done')) then
      raise exception 'Invalid task step';
    end if;
  else
    if new.assignee_id is distinct from old.assignee_id then
      if old.status not in ('new', 'sent', 'seen') then
        raise exception 'A started or closed task cannot be reassigned';
      end if;
      new.status := 'new';
      new.sent_at := null; new.seen_at := null;
      insert into public.task_events (task_id, event, actor_id, meta)
        values (new.id, 'reassigned', me, jsonb_build_object('from', old.assignee_id, 'to', new.assignee_id));
    elsif new.status is distinct from old.status and not (
         (old.status = 'new' and new.status = 'sent')
      or (old.status in ('new', 'sent', 'seen', 'in_progress') and new.status = 'cancelled')) then
      raise exception 'The manager can send or cancel a task; the technician starts and finishes it';
    end if;
  end if;

  -- Server-owned times: copied from the old row unless this update is the step that sets them.
  new.sent_at := coalesce(new.sent_at, old.sent_at);
  if new.assignee_id is not distinct from old.assignee_id then
    new.sent_at := old.sent_at; new.seen_at := old.seen_at;
  end if;
  new.started_at := old.started_at; new.completed_at := old.completed_at; new.cancelled_at := old.cancelled_at;

  if new.status is distinct from old.status then
    t := public.event_time(new.recorded_offline, new.device_time, coalesce(old.started_at, old.sent_at, old.created_at));
    case new.status
      when 'sent' then
        new.sent_at := now();
      when 'seen' then
        new.seen_at := t;
        insert into public.task_events (task_id, event, actor_id, at, recorded_offline) values (new.id, 'seen', me, t, new.recorded_offline);
      when 'in_progress' then
        new.seen_at := coalesce(new.seen_at, t);
        new.started_at := t;
        insert into public.task_events (task_id, event, actor_id, at, recorded_offline) values (new.id, 'started', me, t, new.recorded_offline);
      when 'done' then
        new.completed_at := greatest(t, new.started_at);
        insert into public.task_events (task_id, event, actor_id, at, recorded_offline) values (new.id, 'completed', me, new.completed_at, new.recorded_offline);
      when 'cancelled' then
        if length(btrim(coalesce(new.cancel_reason, ''))) = 0 then
          raise exception 'Cancelling a task needs a reason';
        end if;
        new.cancelled_at := now();
        insert into public.task_events (task_id, event, actor_id) values (new.id, 'cancelled', me);
      else
        null;
    end case;
  end if;
  return new;
end $$;

create trigger tasks_guard before insert or update on public.tasks
  for each row execute function public.tasks_guard();

create function public.tasks_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.task_events (task_id, event, actor_id) values (new.id, 'created', new.created_by);
  return new;
end $$;

create trigger tasks_created after insert on public.tasks
  for each row execute function public.tasks_created();

-- Logging an SMS or WhatsApp send marks the task as sent.
create function public.outgoing_message_logged() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.created_by := coalesce(public.current_employee_id(), new.created_by);
  if new.task_id is not null then
    insert into public.task_events (task_id, event, actor_id, meta)
      values (new.task_id, case new.channel when 'sms' then 'sent_sms' else 'sent_whatsapp' end, new.created_by,
              jsonb_build_object('to', new.to_phone));
    update public.tasks set status = 'sent' where id = new.task_id and status = 'new';
  end if;
  return new;
end $$;

create trigger outgoing_message_logged before insert on public.outgoing_messages
  for each row execute function public.outgoing_message_logged();

-- ---------- Change history ----------
create function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
begin
  if tg_op = 'UPDATE' and (o - 'updated_at') = (n - 'updated_at') then
    return new;
  end if;
  insert into public.audit_log (table_name, record_id, action, actor_id, old_row, new_row)
    values (tg_table_name, coalesce(n, o) ->> 'id', lower(tg_op), public.current_employee_id(), o, n);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'employees', 'app_settings', 'work_schedules', 'generators', 'fuel_types', 'zones', 'task_types',
    'site_reports', 'site_report_fuel', 'generator_day_logs', 'generator_runs', 'maintenance_logs',
    'distribution_sheets', 'zone_day_entries', 'zone_runs', 'tasks', 'attendance_points',
    'attendance_punches', 'leaves'] loop
    execute format('create trigger %I after update or delete on public.%I for each row execute function public.audit_row()',
                   t || '_audit', t);
  end loop;
end $$;

-- ---------- Row level security ----------
do $$
declare t text;
begin
  foreach t in array array[
    'work_schedules', 'employees', 'app_settings', 'holidays', 'generators', 'fuel_types', 'site_reports',
    'site_report_fuel', 'generator_day_logs', 'generator_runs', 'maintenance_logs', 'zones',
    'distribution_sheets', 'zone_day_entries', 'zone_runs', 'task_types', 'tasks', 'task_events',
    'outgoing_messages', 'attendance_points', 'attendance_punches', 'leaves', 'audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  -- Reference lists: every active employee reads, managers edit.
  foreach t in array array['work_schedules', 'app_settings', 'holidays', 'generators', 'fuel_types', 'zones', 'task_types'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.current_employee_id() is not null)', t || '_read', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_manager()) with check (public.is_manager())', t || '_manage', t);
  end loop;
end $$;

-- People: everyone sees the team list; only the admin adds or changes people.
create policy employees_read on public.employees for select to authenticated
  using (public.current_employee_id() is not null);
create policy employees_admin on public.employees for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

-- Generation report: the site operator and the managers.
create policy site_reports_read on public.site_reports for select to authenticated
  using (public.has_role('admin', 'manager', 'generation_operator'));
create policy site_reports_insert on public.site_reports for insert to authenticated
  with check (public.has_role('admin', 'manager', 'generation_operator'));
create policy site_reports_update on public.site_reports for update to authenticated
  using (public.has_role('admin', 'manager', 'generation_operator'))
  with check (public.has_role('admin', 'manager', 'generation_operator'));
create policy site_reports_delete on public.site_reports for delete to authenticated
  using (public.has_role('admin'));

create policy site_report_fuel_read on public.site_report_fuel for select to authenticated
  using (public.has_role('admin', 'manager', 'generation_operator'));
create policy site_report_fuel_write on public.site_report_fuel for all to authenticated
  using (public.site_report_editable(report_id)) with check (public.site_report_editable(report_id));
create policy generator_day_logs_read on public.generator_day_logs for select to authenticated
  using (public.has_role('admin', 'manager', 'generation_operator'));
create policy generator_day_logs_write on public.generator_day_logs for all to authenticated
  using (public.site_report_editable(report_id)) with check (public.site_report_editable(report_id));
create policy generator_runs_read on public.generator_runs for select to authenticated
  using (public.has_role('admin', 'manager', 'generation_operator'));
create policy generator_runs_write on public.generator_runs for all to authenticated
  using (public.generator_log_editable(log_id)) with check (public.generator_log_editable(log_id));
create policy maintenance_logs_read on public.maintenance_logs for select to authenticated
  using (public.has_role('admin', 'manager', 'generation_operator'));
create policy maintenance_logs_write on public.maintenance_logs for all to authenticated
  using (public.site_report_editable(report_id)) with check (public.site_report_editable(report_id));

-- Distribution sheet: the distribution supervisor and the managers.
create policy distribution_sheets_read on public.distribution_sheets for select to authenticated
  using (public.has_role('admin', 'manager', 'distribution_supervisor'));
create policy distribution_sheets_insert on public.distribution_sheets for insert to authenticated
  with check (public.has_role('admin', 'manager', 'distribution_supervisor'));
create policy distribution_sheets_update on public.distribution_sheets for update to authenticated
  using (public.has_role('admin', 'manager', 'distribution_supervisor'))
  with check (public.has_role('admin', 'manager', 'distribution_supervisor'));
create policy distribution_sheets_delete on public.distribution_sheets for delete to authenticated
  using (public.has_role('admin'));
create policy zone_day_entries_read on public.zone_day_entries for select to authenticated
  using (public.has_role('admin', 'manager', 'distribution_supervisor'));
create policy zone_day_entries_write on public.zone_day_entries for all to authenticated
  using (public.distribution_sheet_editable(sheet_id)) with check (public.distribution_sheet_editable(sheet_id));
create policy zone_runs_read on public.zone_runs for select to authenticated
  using (public.has_role('admin', 'manager', 'distribution_supervisor'));
create policy zone_runs_write on public.zone_runs for all to authenticated
  using (public.zone_entry_editable(entry_id)) with check (public.zone_entry_editable(entry_id));

-- Tasks: managers see all; a technician sees only tasks assigned to them.
create policy tasks_read on public.tasks for select to authenticated
  using (public.is_manager() or assignee_id = public.current_employee_id());
create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.is_manager());
create policy tasks_update on public.tasks for update to authenticated
  using (public.is_manager() or assignee_id = public.current_employee_id())
  with check (public.is_manager() or assignee_id = public.current_employee_id());
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.has_role('admin'));
create policy task_events_read on public.task_events for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id
                 and (public.is_manager() or t.assignee_id = public.current_employee_id())));
create policy outgoing_messages_manage on public.outgoing_messages for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- Attendance: QR codes are visible to managers only; employees see their own punches.
create policy attendance_points_manage on public.attendance_points for all to authenticated
  using (public.is_manager()) with check (public.is_manager());
create policy attendance_punches_read on public.attendance_punches for select to authenticated
  using (public.is_manager() or employee_id = public.current_employee_id());
create policy attendance_punches_manage on public.attendance_punches for all to authenticated
  using (public.is_manager()) with check (public.is_manager());
create policy leaves_read on public.leaves for select to authenticated
  using (public.is_manager() or employee_id = public.current_employee_id());
create policy leaves_manage on public.leaves for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

create policy audit_log_read on public.audit_log for select to authenticated
  using (public.is_manager());

-- Nothing is readable without signing in.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;
