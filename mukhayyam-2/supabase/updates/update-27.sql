-- =====================================================================
--  نظام مخيم 2: التحديث 27 · «تم الإنجاز» من المكتب لفني ما عنده جوال ذكي
--  يُطبَّق تلقائياً مع الرفع (أو الصقه في Supabase > SQL Editor ثم Run). تكراره لا يضر.
-- =====================================================================

create or replace function public.tasks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  acting uuid := nullif(current_setting('m2.acting_employee', true), '')::uuid;
  me uuid := coalesce(acting, public.current_employee_id());
  mgr boolean := acting is null and (public.is_manager() or public.has_page('tasks'));
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
      or (old.status in ('new', 'sent', 'seen', 'in_progress') and new.status = 'cancelled')
      -- A technician without a smartphone: the office marks the task done for him.
      or (old.status in ('new', 'sent', 'seen', 'in_progress') and new.status = 'done' and new.assignee_id is not null)) then
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
        new.started_at := coalesce(new.started_at, least(t, coalesce(old.seen_at, old.sent_at, t)));
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


notify pgrst, 'reload schema';
