-- =====================================================================
--  نظام مخيم 2: روابط المهام للفنيين (بدون تطبيق وبدون دخول)
--  لمشروع شُغّل عليه setup.sql من قبل: الصق هذا الملف في SQL Editor ثم Run، مرة واحدة.
-- =====================================================================
-- Technicians have no app and no login. The manager sends the order by WhatsApp or SMS; its last
-- line is a private link (/t/<link_token>). Opening it marks the task seen; one button records
-- "started" and one "finished", with the server's time. The link names one task only.

alter table public.tasks
  add column link_token text unique
  default translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/', '-_');

-- Who acts in tasks_guard: the signed-in person, or the task's technician when the action comes
-- through the task link (set by task_link_* below for the current transaction only).
create or replace function public.tasks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  acting uuid := nullif(current_setting('m2.acting_employee', true), '')::uuid;
  me uuid := coalesce(acting, public.current_employee_id());
  mgr boolean := acting is null and public.is_manager();
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
    if me is null or old.assignee_id is distinct from me then
      raise exception 'This task is not assigned to you';
    end if;
    if (new.task_type_id, new.assignee_id, new.details, new.subscriber_name, new.subscriber_phone,
        new.zone_id, new.location_text, new.priority, new.expected_minutes, new.created_by, new.cancel_reason, new.link_token)
       is distinct from
       (old.task_type_id, old.assignee_id, old.details, old.subscriber_name, old.subscriber_phone,
        old.zone_id, old.location_text, old.priority, old.expected_minutes, old.created_by, old.cancel_reason, old.link_token) then
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

-- What the technician sees behind the link. The first open marks the task "seen".
create function public.task_link_view(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.tasks;
begin
  select * into t from public.tasks where link_token = p_token;
  if not found then return null; end if;
  if t.status in ('new', 'sent') then
    perform set_config('m2.acting_employee', t.assignee_id::text, true);
    update public.tasks set status = 'seen' where id = t.id returning * into t;
    perform set_config('m2.acting_employee', '', true);
  end if;
  return jsonb_build_object(
    'number', t.number,
    'type', (select name from public.task_types where id = t.task_type_id),
    'assignee', (select full_name from public.employees where id = t.assignee_id),
    'details', t.details,
    'subscriber_name', t.subscriber_name,
    'subscriber_phone', t.subscriber_phone,
    'zone', (select name from public.zones where id = t.zone_id),
    'location', t.location_text,
    'priority', t.priority,
    'expected_minutes', t.expected_minutes,
    'status', t.status,
    'sent_at', t.sent_at,
    'started_at', t.started_at,
    'completed_at', t.completed_at,
    'completion_notes', t.completion_notes
  );
end $$;

-- The two buttons behind the link: 'start' and 'done' (with an optional note for the manager).
-- Pressing "done" without "start" closes the task in one go. Pressing twice changes nothing.
create function public.task_link_act(p_token text, p_action text, p_notes text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.tasks;
begin
  select * into t from public.tasks where link_token = p_token for update;
  if not found then raise exception 'not_found'; end if;
  if t.status = 'cancelled' then raise exception 'cancelled'; end if;
  if p_action not in ('start', 'done') then raise exception 'bad_action'; end if;

  perform set_config('m2.acting_employee', t.assignee_id::text, true);
  if t.status in ('new', 'sent', 'seen') then
    update public.tasks set status = 'in_progress' where id = t.id;
  end if;
  if p_action = 'done' and t.status <> 'done' then
    update public.tasks set status = 'done', completion_notes = nullif(btrim(coalesce(p_notes, '')), '') where id = t.id;
  end if;
  perform set_config('m2.acting_employee', '', true);
  return public.task_link_view(p_token);
end $$;

revoke execute on function public.task_link_view(text) from public;
revoke execute on function public.task_link_act(text, text, text) from public;
grant execute on function public.task_link_view(text) to anon, authenticated;
grant execute on function public.task_link_act(text, text, text) to anon, authenticated;

-- Tell the Data API about the new functions right away.
notify pgrst, 'reload schema';
