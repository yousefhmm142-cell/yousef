-- One optional link from a used seal to its completed task. Existing rows are untouched.
alter table public.seals add column if not exists task_id uuid references public.tasks(id) on delete set null;
create index if not exists seals_task_id on public.seals(task_id) where task_id is not null;
alter table public.tasks add column if not exists completed_work text not null default '';
alter table public.tasks add column if not exists used_seals integer[] not null default '{}';
insert into public.task_types(name,sort_order) values('صيانة كابل',210),('شبك غاطس',211),('فصل غاطس',212) on conflict(name) do nothing;
-- Task notes must not lose seal references when another screen updates an old cached task.
-- Syncing tasks through its guard would make a technician's read-only shared task writable indirectly.
-- Only the office-authorized record RPC below updates used_seals; clients cannot alter it directly.
create or replace function public.task_seals_guard() returns trigger
language plpgsql set search_path=public as $$ begin
 if new.used_seals is distinct from old.used_seals and coalesce(current_setting('m2.link_seal',true),'')<>'yes' then raise exception 'seal_references_owned';end if;
 return new;
end $$;
drop trigger if exists tasks_seal_references on public.tasks;
create trigger tasks_seal_references before update on public.tasks for each row execute function public.task_seals_guard();

-- Candidate projection for accountants: no task tokens or coworkers' phone numbers.
create or replace function public.seal_task_candidates(p_seal integer) returns table(id uuid,number bigint,subscriber text,work text,completed_at timestamptz)
language plpgsql stable security definer set search_path=public as $$ begin
 if not public.has_seals() then raise exception 'not_allowed' using errcode='42501';end if;
 return query select t.id,t.number::bigint,t.subscriber_name,coalesce(nullif(t.completed_work,''),ty.name),t.completed_at from tasks t join task_types ty on ty.id=t.task_type_id join seals s on s.seal_no=p_seal where t.status='done' and s.technician_id=any(public.task_member_ids(t.assignee_id,t.assignee_ids)) order by (t.id=s.task_id) desc,t.completed_at desc limit 100;
end $$;

create or replace function public.seal_record_task(p_seal integer,p_status text,p_date date,p_details text,p_task uuid) returns void
language plpgsql security definer set search_path=public as $$
declare s public.seals;t public.tasks;begin
 if not public.has_seals() then raise exception 'not_allowed' using errcode='42501';end if;
 -- Always lock the task before its seals, the same order as task_complete_seals.
 if p_task is not null then
  select * into t from tasks where id=p_task for update;
  if not found or t.status<>'done' or p_status<>'used' then raise exception 'task_not_completed';end if;
 end if;
 select * into s from seals where seal_no=p_seal for update;
 if not found then raise exception 'unknown_seal';end if;
 if p_task is not null and (s.technician_id is null or not(s.technician_id=any(public.task_member_ids(t.assignee_id,t.assignee_ids)))) then raise exception 'seal_wrong_technician';end if;
 perform public.seal_record(p_seal,p_status,p_date,p_details);
 update seals set task_id=case when p_status='used' then p_task else null end where seal_no=p_seal;
 perform set_config('m2.link_seal','yes',true);
 -- For shared tasks the office is the actor here, never a secondary technician.
 update tasks set used_seals=coalesce((select array_agg(seal_no order by seal_no) from seals where task_id=tasks.id and status='used'),'{}') where id in (s.task_id,p_task);
 perform set_config('m2.link_seal','',true);
end $$;

create table if not exists public.task_completion_receipts(operation uuid primary key,task_id uuid not null references tasks(id) on delete cascade,actor_id uuid not null references employees(id),created_at timestamptz not null default now());
alter table public.task_completion_receipts enable row level security;
revoke all on public.task_completion_receipts from public,anon,authenticated;
-- Atomic completion, optional seals and their work: a failed seal rolls back the whole completion.
drop function if exists public.task_complete_seals(uuid,integer[],text,text,text,uuid);
create or replace function public.task_complete_seals(p_task uuid,p_seals integer[],p_notes text,p_work text,p_board text,p_operation uuid,p_time timestamptz default null,p_offline boolean default false) returns void
language plpgsql security definer set search_path=public as $$
declare t public.tasks;s public.seals;me uuid:=public.current_employee_id();office boolean:=public.is_manager() or public.has_page('tasks');members uuid[];n integer;line text;nums integer[];v_time timestamptz;
begin
 if me is null then raise exception 'not_allowed' using errcode='42501';end if;
 select * into t from tasks where id=p_task for update;
 if not found then raise exception 'not_found';end if;
 members:=public.task_member_ids(t.assignee_id,t.assignee_ids);
 if not office and (cardinality(members)<>1 or not(me=any(members))) then raise exception 'not_allowed' using errcode='42501';end if;
 select coalesce(array_agg(distinct x order by x),'{}') into nums from unnest(coalesce(p_seals,'{}')) x;
 if cardinality(nums)>50 or array_position(nums,null) is not null then raise exception 'bad_seals';end if;
 if p_operation is null then raise exception 'bad_request';end if;
 if t.status='done' then
  if exists(select 1 from task_completion_receipts where operation=p_operation and task_id=p_task and actor_id=me) then return;end if;
  raise exception 'task_closed';
 end if;
 if t.status='cancelled' or cardinality(members)=0 then raise exception 'task_closed';end if;
 line:=concat_ws(' ',case when nullif(btrim(p_board),'') is not null then 'طبلون '||btrim(p_board) end,nullif(btrim(p_work),''));
 if nullif(btrim(t.subscriber_name),'') is not null then line:=line||' ('||t.subscriber_name||')';end if;
 if cardinality(nums)>0 and nullif(btrim(p_work),'') is null then raise exception 'work_required';end if;
 for n in select unnest(nums) order by 1 loop
  select * into s from seals where seal_no=n for update;
  if not found or s.status<>'issued' or s.task_id is not null then raise exception 'seal_not_available:%',n;end if;
  if s.technician_id is null or not(s.technician_id=any(members)) then raise exception 'seal_wrong_technician:%',n;end if;
 end loop;
 v_time:=public.event_time(coalesce(p_offline,false),p_time,coalesce(t.started_at,t.sent_at,t.created_at));
 -- Direct finish is available to the assigned single technician; the ordinary trigger still validates his steps.
 if not office and t.status in ('new','sent','seen') then update tasks set status='in_progress',recorded_offline=coalesce(p_offline,false),device_time=v_time where id=p_task;end if;
 update tasks set status='done',completion_notes=coalesce(p_notes,''),completed_work=coalesce(p_work,''),recorded_offline=coalesce(p_offline,false),device_time=v_time where id=p_task;
 for n in select unnest(nums) loop
  update seals set status='used',used_on=(v_time at time zone 'Asia/Gaza')::date,details=line,board_no=nullif(btrim(p_board),''),task_id=p_task,updated_by=me where seal_no=n;
 end loop;
 perform set_config('m2.link_seal','yes',true);
 update tasks set used_seals=nums where id=p_task;
 perform set_config('m2.link_seal','',true);
 insert into task_completion_receipts(operation,task_id,actor_id) values(p_operation,p_task,me);
end $$;

drop function public.seal_work_statement(date,date);
create or replace function public.seal_work_statement(p_from date, p_to date)
returns table (seal_no integer, technician_id uuid, used_on date, issued_on date, details text, board_no text, task_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_manager() or public.has_seals() or public.has_page('tasks') or public.has_page('reports') or public.has_page('seal-work')) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return query
    select s.seal_no, s.technician_id, s.used_on, s.issued_on, s.details, s.board_no, s.task_id
      from public.seals s
     where s.status = 'used' and s.technician_id is not null
       and coalesce(s.used_on, s.issued_on) between coalesce(p_from, date '2000-01-01') and coalesce(p_to, date '2999-12-31')
     order by coalesce(s.used_on, s.issued_on), s.seal_no;
end $$;

revoke all on function public.seal_task_candidates(integer),public.seal_record_task(integer,text,date,text,uuid),public.task_complete_seals(uuid,integer[],text,text,text,uuid,timestamptz,boolean),public.seal_work_statement(date,date) from public,anon;
grant execute on function public.seal_task_candidates(integer),public.seal_record_task(integer,text,date,text,uuid),public.task_complete_seals(uuid,integer[],text,text,text,uuid,timestamptz,boolean),public.seal_work_statement(date,date) to authenticated;
notify pgrst,'reload schema';

create or replace function public.tasks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  acting uuid := nullif(current_setting('m2.acting_employee', true), '')::uuid;
  me uuid := coalesce(acting, public.current_employee_id());
  mgr boolean := acting is null and (public.is_manager() or public.has_page('tasks'));
  t timestamptz;
  members uuid[]; old_members uuid[]; members_changed boolean;
begin
  if tg_op='INSERT' and cardinality(new.used_seals)>0 then raise exception 'seal_references_owned';end if;
  if tg_op='UPDATE' and coalesce(current_setting('m2.link_seal',true),'')='yes' then
    if (to_jsonb(new)-'used_seals'-'actual_minutes') is distinct from (to_jsonb(old)-'used_seals'-'actual_minutes') then raise exception 'seal_reference_fields_only';end if;
    return new;
  end if;
  if tg_op='UPDATE' then
    old_members:=public.task_member_ids(old.assignee_id,old.assignee_ids);
    -- Old clients change only the primary technician; retain that contract.
    if new.assignee_id is distinct from old.assignee_id and new.assignee_ids is not distinct from old.assignee_ids then
      new.assignee_ids:=case when new.assignee_id is null then '{}'::uuid[] else array[new.assignee_id] end;
    end if;
  end if;
  members:=public.task_member_ids(new.assignee_id,new.assignee_ids);
  new.assignee_ids:=members;new.assignee_id:=members[1];
  members_changed:=tg_op='INSERT' or members is distinct from old_members;
  if cardinality(members)>20 then raise exception 'too_many_technicians';end if;
  if members_changed and exists(select 1 from unnest(members) as member(member_id) where not exists(select 1 from public.employees e where e.id=member.member_id and e.role='technician' and e.is_active and e.deleted_at is null)) then raise exception 'invalid_technician';end if;
  if tg_op = 'INSERT'  then
    new.created_by := coalesce(me, new.created_by);
    new.status := 'new';
    new.sent_at := null; new.seen_at := null; new.started_at := null;
    new.completed_at := null; new.cancelled_at := null;
    return new;
  end if;

  if not mgr then
    if me is null or not (me=any(old_members)) then
      raise exception 'This task is not assigned to you';
    end if;
    if cardinality(old_members)>1 then raise exception 'office_completes_shared';end if;
    if (new.task_type_id, new.assignee_id, new.assignee_ids, new.details, new.subscriber_name, new.subscriber_phone,
        new.zone_id, new.location_text, new.priority, new.expected_minutes, new.created_by, new.cancel_reason, new.link_token)
       is distinct from
       (old.task_type_id, old.assignee_id, old_members, old.details, old.subscriber_name, old.subscriber_phone,
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
    if members_changed then
      if old.status not in ('new', 'sent', 'seen') then
        raise exception 'A started or closed task cannot be reassigned';
      end if;
      new.status := 'new';
      new.sent_at := null; new.seen_at := null;
      insert into public.task_events (task_id, event, actor_id, meta)
        values (new.id, 'reassigned', me, jsonb_build_object('from',old.assignee_id,'to',new.assignee_id,'from_members',old_members,'to_members',members));
    elsif new.status is distinct from old.status and not (
         (old.status = 'new' and new.status = 'sent')
      or (old.status in ('new', 'sent', 'seen', 'in_progress') and new.status = 'cancelled')
      -- A technician without a smartphone: the office marks the task done for him.
      or (old.status in ('new', 'sent', 'seen', 'in_progress') and new.status = 'done' and new.assignee_id is not null)) then
      raise exception 'The manager can send or cancel a task; the technician starts and finishes it';
    end if;
  end if;

  -- Server-owned times: copied from the old row unless this update is the step that sets them.
  if not members_changed then new.sent_at:=old.sent_at;new.seen_at:=old.seen_at;
  else new.sent_at:=null;new.seen_at:=null;end if;
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
        new.cancel_reason := nullif(btrim(coalesce(new.cancel_reason, '')), '');
        new.cancelled_at := now();
        insert into public.task_events (task_id, event, actor_id) values (new.id, 'cancelled', me);
      else
        null;
    end case;
  end if;
  return new;
end $$;

create or replace function public.seal_link_clear() returns trigger language plpgsql set search_path=public as $$ begin if new.status<>'used' then new.task_id:=null;end if;return new;end $$;
drop trigger if exists seal_link_clear on seals;
create trigger seal_link_clear before update on seals for each row execute function public.seal_link_clear();
create or replace function public.seal_link_sync() returns trigger language plpgsql security definer set search_path=public as $$ declare previous text:=coalesce(current_setting('m2.link_seal',true),'');begin
 perform set_config('m2.link_seal','yes',true);
 update tasks set used_seals=coalesce((select array_agg(seal_no order by seal_no) from seals where task_id=tasks.id and status='used'),'{}') where id in (old.task_id,new.task_id);
 perform set_config('m2.link_seal',previous,true);return new;
end $$;
drop trigger if exists seal_link_sync on seals;
create trigger seal_link_sync after update of task_id,status on seals for each row when (old.task_id is distinct from new.task_id or old.status is distinct from new.status) execute function public.seal_link_sync();
