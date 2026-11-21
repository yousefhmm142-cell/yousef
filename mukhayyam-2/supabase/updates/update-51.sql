-- Update 51: search, assign prepared tasks and finish tasks atomically from seal recording. Safe to repeat.
-- Search safe task suggestions without exposing the raw tasks table or changing workflow.
-- Keep seal_task_candidates(integer) unchanged for already-open/older clients.
create or replace function m2_ops.seal_task_search_text(v text) returns text
language sql immutable set search_path=public as $$
 select m2_ops.work_match_text(translate(replace(translate(coalesce(v,''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'#',''),'ةؤئٱ','هويا'))
$$;
create or replace function public.seal_task_search(p_seal integer,p_query text default '')
returns table(id uuid,number bigint,subscriber text,work text,completed_at timestamptz,technician_id uuid,board text,completed_on date,task_status text,task_on date,is_prepared boolean,total_count bigint)
language plpgsql stable security definer set search_path=public as $$
declare q text:=m2_ops.seal_task_search_text(p_query);
begin
 if not public.has_seals() then raise exception 'not_allowed' using errcode='42501';end if;
 if length(coalesce(p_query,''))>160 then raise exception 'search_too_long';end if;
 return query
 with scoped as (
  select t.*,ty.name as type_name,s.technician_id as holder,s.task_id as linked,
   cardinality(public.task_member_ids(t.assignee_id,t.assignee_ids))=0 as prepared,
   coalesce(case when t.status='done' then t.completed_at else t.sent_at end,t.created_at) as task_stamp
  from tasks t join task_types ty on ty.id=t.task_type_id join seals s on s.seal_no=p_seal
  where s.technician_id is not null and t.status in ('new','sent','seen','in_progress','done')
  and (s.technician_id=any(public.task_member_ids(t.assignee_id,t.assignee_ids))
    or (t.status='new' and cardinality(public.task_member_ids(t.assignee_id,t.assignee_ids))=0))
 ), projected as (
  select t.id,t.number::bigint,t.subscriber_name as subscriber,coalesce(nullif(t.completed_work,''),t.type_name) as work,t.completed_at,
   case when t.prepared then null::uuid else t.holder end as technician_id,
   coalesce(nullif(public.seal_board_no(t.location_text),''),
    case when btrim(t.location_text) ~ '^[0-9]+[A-Za-z]?$' then btrim(t.location_text) end,
    (select min(x.board_no) from seals x where x.task_id=t.id and x.status='used' and nullif(btrim(x.board_no),'') is not null having count(distinct btrim(x.board_no))=1),
    (select min(x.board) from subscribers x where m2_ops.work_match_text(x.full_name)=m2_ops.work_match_text(t.subscriber_name) and nullif(btrim(x.board),'') is not null having count(distinct btrim(x.board))=1),'') as board,
   (t.completed_at at time zone 'Asia/Gaza')::date as completed_on,t.status::text as task_status,
   (t.task_stamp at time zone 'Asia/Gaza')::date as task_on,t.prepared,t.task_stamp,t.linked,t.location_text,
   case when t.prepared then 'مجهزة بدون فني' else case t.status when 'new' then 'معينة لفني' when 'sent' then 'مرسلة مبعوثة' when 'seen' then 'تم الاطلاع' when 'in_progress' then 'قيد التنفيذ' when 'done' then 'منجزة تم' end end as state_label
  from scoped t
  where q<>'' or t.id=t.linked or (t.task_stamp at time zone 'Asia/Gaza')::date between public.seal_today()-6 and public.seal_today()
 ), matched as (
  select p.* from projected p where not exists (
   select 1 from regexp_split_to_table(q,'[[:space:]]+') word
   where word<>'' and position(word in m2_ops.seal_task_search_text(concat_ws(' ',p.number,p.subscriber,p.work,p.board,p.location_text,p.completed_on,p.task_on,p.state_label)))=0
  )
 )
 select p.id,p.number,p.subscriber,p.work,p.completed_at,p.technician_id,p.board,p.completed_on,p.task_status,p.task_on,p.prepared,count(*) over()
 from matched p order by (p.id=p.linked) desc nulls last,p.task_stamp desc,p.id limit 100;
end $$;
revoke all on function m2_ops.seal_task_search_text(text) from public,anon,authenticated;
revoke all on function public.seal_task_search(integer,text) from public,anon;
grant execute on function public.seal_task_search(integer,text) to authenticated;
notify pgrst,'reload schema';

-- Narrow, transaction-local authority: only this RPC can create a completion context.
create table if not exists m2_ops.seal_completion_context(tx bigint,pid integer,task_id uuid,actor_id uuid,completed_at timestamptz not null,primary key(tx,pid,task_id));
create table if not exists m2_ops.seal_completion_receipts(operation uuid primary key,actor_id uuid not null,task_id uuid not null,seal_no integer not null,fingerprint text not null,created_at timestamptz not null default now());
revoke all on m2_ops.seal_completion_context,m2_ops.seal_completion_receipts from public,anon,authenticated;
create or replace function m2_ops.seal_completion_time(p_task uuid,p_actor uuid) returns timestamptz
language sql stable security definer set search_path=public as $$
 select c.completed_at from m2_ops.seal_completion_context c where c.tx=txid_current() and c.pid=pg_backend_pid() and c.task_id=p_task and c.actor_id=p_actor and p_actor=public.current_employee_id()
$$;
revoke all on function m2_ops.seal_completion_time(uuid,uuid) from public,anon,authenticated;

-- Keep every existing guard; the sealed context permits only the validated task below.
create or replace function public.tasks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  acting uuid := nullif(current_setting('m2.acting_employee', true), '')::uuid;
  me uuid := coalesce(acting, public.current_employee_id());
  mgr boolean := acting is null and (public.is_manager() or public.has_page('tasks'));
  t timestamptz;
  members uuid[]; old_members uuid[]; members_changed boolean; seal_time timestamptz;
begin
  seal_time:=m2_ops.seal_completion_time(new.id,me);
  mgr:=mgr or seal_time is not null;
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
    t := coalesce(seal_time,public.event_time(new.recorded_offline, new.device_time, coalesce(old.started_at, old.sent_at, old.created_at)));
    case new.status
      when 'sent' then
        new.sent_at := coalesce(seal_time,now());
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

create or replace function public.seal_finish_task(p_seal integer,p_task uuid,p_technician uuid,p_date date,p_work text,p_board text,p_subscriber text,p_operation uuid,p_actor uuid) returns void
language plpgsql security definer set search_path=public as $$
declare me uuid:=public.current_employee_id();t public.tasks;s public.seals;r m2_ops.seal_completion_receipts;members uuid[];stamp timestamptz;line text;finger text;
begin
 if me is null or me is distinct from p_actor or not public.has_seals() then raise exception 'not_allowed' using errcode='42501';end if;
 if p_operation is null then raise exception 'bad_request';end if;
 finger:=md5(jsonb_build_array(p_task,p_seal,p_technician,p_date,p_work,p_board,p_subscriber)::text);
 select * into r from m2_ops.seal_completion_receipts where operation=p_operation;
 if found then
  if r.actor_id=me and r.fingerprint=finger then return;end if;raise exception 'operation_conflict';
 end if;
 -- Same lock order as task_complete_seals: task, then its seal.
 select * into t from tasks where id=p_task for update;
 if not found then raise exception 'not_found';end if;
 select * into r from m2_ops.seal_completion_receipts where operation=p_operation;
 if found then
  if r.actor_id=me and r.fingerprint=finger then return;end if;raise exception 'operation_conflict';
 end if;
 if t.status='cancelled' then raise exception 'task_closed';end if;
 select * into s from seals where seal_no=p_seal for update;
 if not found then raise exception 'unknown_seal';end if;
 if s.technician_id is null or s.status not in ('issued','used') or (s.task_id is not null and s.task_id<>p_task) then raise exception 'seal_not_available';end if;
 if nullif(btrim(p_work),'') is null then raise exception 'work_required';end if;
 if p_date is null or p_date>public.seal_today() or p_date<(t.created_at at time zone 'Asia/Gaza')::date or (t.started_at is not null and p_date<(t.started_at at time zone 'Asia/Gaza')::date) then raise exception 'bad_date';end if;
 if nullif(btrim(t.subscriber_name),'') is not null and m2_ops.work_match_text(t.subscriber_name)<>m2_ops.work_match_text(p_subscriber) then raise exception 'task_subscriber_mismatch';end if;
 members:=public.task_member_ids(t.assignee_id,t.assignee_ids);
 if cardinality(members)=0 then
  if t.status<>'new' or p_technician is null then raise exception 'technician_required';end if;
  if p_technician<>s.technician_id then raise exception 'seal_wrong_technician';end if;
  if not exists(select 1 from employees where id=p_technician and role='technician' and is_active and deleted_at is null) then raise exception 'invalid_technician';end if;
  members:=array[p_technician];
 elsif not(s.technician_id=any(members)) or (p_technician is not null and not(p_technician=any(members))) then raise exception 'seal_wrong_technician';
 end if;
 stamp:=case when p_date=public.seal_today() then public.server_now() else (p_date+time '12:00') at time zone 'Asia/Gaza' end;
 stamp:=least(public.server_now(),greatest(stamp,t.created_at,coalesce(t.started_at,t.created_at)));
 if t.status<>'done' then
  insert into m2_ops.seal_completion_context values(txid_current(),pg_backend_pid(),p_task,me,stamp);
  if cardinality(public.task_member_ids(t.assignee_id,t.assignee_ids))=0 then
   update tasks set assignee_id=p_technician,assignee_ids=members where id=p_task;
  end if;
  if t.status='new' then update tasks set status='sent' where id=p_task;end if;
  update tasks set status='done',completed_work=btrim(p_work),subscriber_name=coalesce(nullif(btrim(subscriber_name),''),btrim(p_subscriber)) where id=p_task;
  delete from m2_ops.seal_completion_context where tx=txid_current() and pid=pg_backend_pid() and task_id=p_task;
 else
  -- Another accountant may have just completed the same task with a different seal.
  if p_date is distinct from (t.completed_at at time zone 'Asia/Gaza')::date then raise exception 'task_date_conflict';end if;
 end if;
 line:=concat_ws(' ',case when nullif(btrim(p_board),'') is not null then 'طبلون '||btrim(p_board) end,btrim(p_work),case when nullif(btrim(p_subscriber),'') is not null then '('||btrim(p_subscriber)||')' end);
 perform public.seal_record_task(p_seal,'used',p_date,line,p_task);
 insert into m2_ops.seal_completion_receipts(operation,actor_id,task_id,seal_no,fingerprint) values(p_operation,me,p_task,p_seal,finger);
end $$;
revoke all on function public.seal_finish_task(integer,uuid,uuid,date,text,text,text,uuid,uuid) from public,anon;
grant execute on function public.seal_finish_task(integer,uuid,uuid,date,text,text,text,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
