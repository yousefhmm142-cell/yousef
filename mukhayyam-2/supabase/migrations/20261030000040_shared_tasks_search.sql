-- Shared tasks keep one order and one completion owned by the office.
alter table public.tasks add column if not exists assignee_ids uuid[] not null default '{}';
create index if not exists tasks_members on public.tasks using gin(assignee_ids);
create or replace function public.task_member_ids(p_primary uuid,p_members uuid[]) returns uuid[]
language sql immutable set search_path=public as $$
 select coalesce(array_agg(id order by ord),'{}'::uuid[]) from (
 select id,min(ord) ord from unnest(case when cardinality(p_members)>0 then p_members when p_primary is not null then array[p_primary] else '{}'::uuid[] end) with ordinality a(id,ord) where id is not null group by id) x
$$;
create or replace function public.tasks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  acting uuid := nullif(current_setting('m2.acting_employee', true), '')::uuid;
  me uuid := coalesce(acting, public.current_employee_id());
  mgr boolean := acting is null and (public.is_manager() or public.has_page('tasks'));
  t timestamptz;
  members uuid[]; old_members uuid[]; members_changed boolean;
begin
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



drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks for select to authenticated using(public.is_manager() or public.has_page('tasks') or assignee_id=public.current_employee_id() or assignee_ids @> array[public.current_employee_id()]);
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated using(public.is_manager() or public.has_page('tasks') or assignee_id=public.current_employee_id() or assignee_ids @> array[public.current_employee_id()]) with check(public.is_manager() or public.has_page('tasks') or assignee_id=public.current_employee_id() or assignee_ids @> array[public.current_employee_id()]);
drop policy if exists task_events_read on public.task_events;
create policy task_events_read on public.task_events for select to authenticated using(public.is_manager() or public.has_page('tasks') or exists(select 1 from public.tasks t where t.id=task_id and cardinality(public.task_member_ids(t.assignee_id,t.assignee_ids))<=1));
create or replace function public.task_link_view(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.tasks;
begin
  select * into t from public.tasks where link_token = p_token;
  if not found then return null; end if;
  if cardinality(public.task_member_ids(t.assignee_id,t.assignee_ids))<=1 and t.status in ('new', 'sent') then
    perform set_config('m2.acting_employee', t.assignee_id::text, true);
    update public.tasks set status = 'seen' where id = t.id returning * into t;
    perform set_config('m2.acting_employee', '', true);
  end if;
  return jsonb_build_object(
    'number', t.number,
    'type', (select name from public.task_types where id = t.task_type_id),
    'assignee',(select string_agg(e.full_name,'، ' order by e.full_name) from public.employees e where e.id=any(public.task_member_ids(t.assignee_id,t.assignee_ids))),
    'shared',cardinality(public.task_member_ids(t.assignee_id,t.assignee_ids))>1,
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
    'completion_notes', t.completion_notes,
    -- The list to pick used materials from, and what was recorded for this task.
    'items', case when t.status in ('done', 'cancelled') then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'unit', i.unit) order by i.sort_order, i.id)
      from public.stock_items i where i.is_active), '[]'::jsonb) end,
    'materials', coalesce((
      select jsonb_agg(jsonb_build_object('name', i.name, 'unit', i.unit, 'qty', m.qty) order by m.created_at)
      from public.stock_moves m join public.stock_items i on i.id = m.item_id
      where m.task_id = t.id and m.kind = 'out'), '[]'::jsonb)
  );
end $$;

-- Only the office can send a shared order from the subscription. General bulk SMS remains manager-only.
create table if not exists m2_ops.shared_sms_requests(request_id uuid primary key,task_id uuid not null references public.tasks(id) on delete cascade,actor_id uuid not null references public.employees(id),members uuid[] not null,result jsonb not null,created_at timestamptz not null default now());
revoke all on m2_ops.shared_sms_requests from public,anon,authenticated;
create or replace function public.task_sms_units(p_text text) returns integer
language sql immutable set search_path=public as $$ select coalesce(sum(case when ascii(ch)>65535 then 2 else 1 end),0)::integer from regexp_split_to_table(coalesce(p_text,''),'') ch where ch<>'' $$;
create or replace function public.task_sms_trim(p_text text) returns text
language plpgsql immutable set search_path=public as $$ declare t text:=coalesce(p_text,'');begin while public.task_sms_units(t)>70 loop t:=left(t,length(t)-1);end loop;return t;end $$;
create or replace function public.shared_task_sms_text(p_task uuid) returns text
language plpgsql stable set search_path=public as $$
declare t public.tasks%rowtype; head text;who text;place text;msg text;
begin
 select * into t from public.tasks where id=p_task;if not found then return null;end if;
 head:=case t.priority when 'emergency' then 'طارئ ' when 'urgent' then 'مستعجل ' else '' end||'مهمة مشتركة '||t.number||': '||(select name from public.task_types where id=t.task_type_id);
 who:=array_to_string((regexp_split_to_array(btrim(coalesce(t.subscriber_name,'')),E'\\s+'))[1:2],' ');
 place:=concat_ws(' ',(select name from public.zones where id=t.zone_id),nullif(btrim(t.location_text),''));
 msg:=concat_ws(' · ',head,nullif(who,''),nullif(t.subscriber_phone,''),nullif(place,''),nullif(btrim(t.details),''));if public.task_sms_units(msg)<=70 then return msg;end if;
 msg:=concat_ws(' · ',head,nullif(who,''),nullif(t.subscriber_phone,''),nullif(place,''));if public.task_sms_units(msg)<=70 then return msg;end if;
 msg:=concat_ws(' · ',head,nullif(who,''),nullif(t.subscriber_phone,''));if public.task_sms_units(msg)<=70 then return msg;end if;
 return public.task_sms_trim(concat_ws(' · ',head,nullif(t.subscriber_phone,'')));
end $$;
drop function if exists public.task_send_shared_sms(uuid,uuid);
create or replace function public.task_send_shared_sms(p_task uuid,p_request uuid,p_members uuid[]) returns jsonb
language plpgsql security definer set search_path=public,m2_ops as $$
declare t public.tasks%rowtype;who uuid:=public.current_employee_id();members uuid[];e public.employees%rowtype;sms_body text;previous m2_ops.shared_sms_requests%rowtype;code text;ok boolean;sent integer:=0;already integer:=0;failed jsonb:='[]';result jsonb;cfg m2_ops.sms_config;
begin
 if who is null or not (public.is_manager() or public.has_page('tasks')) then raise exception 'not_allowed' using errcode='42501';end if;
 if p_request is null then raise exception 'bad_request';end if;
 perform pg_advisory_xact_lock(hashtextextended('m2-shared-sms:'||p_request::text,0));
 select * into previous from m2_ops.shared_sms_requests where request_id=p_request;
 if found then
  if previous.task_id<>p_task or previous.actor_id<>who or previous.members is distinct from p_members then raise exception 'bad_request';end if;
  return previous.result;
 end if;
 select * into t from public.tasks where id=p_task for update;
 if not found or t.status in ('done','cancelled') then raise exception 'task_closed';end if;
 members:=public.task_member_ids(t.assignee_id,t.assignee_ids);
 if members is distinct from p_members then raise exception 'assignment_changed';end if;
 if cardinality(members)<2 or cardinality(members)>20 then raise exception 'not_shared';end if;
 if exists(select 1 from unnest(members) as member(member_id) where not exists(select 1 from public.employees x where x.id=member.member_id and x.role='technician' and x.is_active and x.deleted_at is null and x.phone ~ '^05[0-9]{8}$')) then raise exception 'missing_technician_phone';end if;
 perform 1 from public.employees where id=any(members) for share;
 sms_body:=public.shared_task_sms_text(p_task);
 select * into cfg from m2_ops.sms_config where id=1;
 foreach who in array members loop
  select * into e from public.employees where id=who;
  if exists(select 1 from public.outgoing_messages m where m.task_id=p_task and m.channel='sms' and m.provider='hotsms' and m.status='sent' and m.to_phone=e.phone and m.body=sms_body) then already:=already+1;continue;end if;
  code:=m2_ops.hotsms('sendbulksms.php',jsonb_build_object('sender',coalesce(cfg.sender,'AF Camp2'),'mobile','972'||substr(e.phone,2),'type','2','text',sms_body));
  ok:=coalesce(code like '1001%',false);
  insert into public.outgoing_messages(task_id,channel,to_phone,body,status,provider,provider_ref,error,sent_at) values(p_task,'sms',e.phone,sms_body,case when ok then 'sent' else 'failed' end::public.message_status,'hotsms',code,case when ok then null else coalesce(code,'unknown') end,case when ok then now() end);
  if ok then sent:=sent+1;else failed:=failed||jsonb_build_object('phone',e.phone,'code',coalesce(code,'unknown'));end if;
 end loop;
 result:=jsonb_build_object('sent',sent,'already',already,'failed',failed,'body',sms_body);
 delete from m2_ops.shared_sms_requests where created_at<now()-interval '30 days';
 insert into m2_ops.shared_sms_requests(request_id,task_id,actor_id,members,result) values(p_request,p_task,public.current_employee_id(),members,result);
 return result;
end $$;

-- Search all authorized task history; it never indexes private task links.
create or replace function public.task_search_fold(p_text text) returns text
language sql immutable set search_path=public as $$
 select btrim(regexp_replace(translate(lower(regexp_replace(coalesce(p_text,''),'[ً-ْـ]','','g')),'أإآٱةىؤئ٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','ااااهيوي01234567890123456789'),'[[:space:]]+',' ','g'))
$$;
create or replace function public.task_search(p_term text,p_offset integer default 0,p_limit integer default 50) returns setof public.tasks
language sql stable set search_path=public as $$
 with directory as materialized (select id,full_name from public.employee_directory())
 select t.* from public.tasks t left join public.task_types ty on ty.id=t.task_type_id left join public.zones z on z.id=t.zone_id
 where length(public.task_search_fold(p_term)) between 1 and 160 and not exists(
 select 1 from unnest(regexp_split_to_array(public.task_search_fold(p_term),' ')) q where strpos(public.task_search_fold(concat_ws(' ','مهمة رقم #'||t.number::text,t.subscriber_name,t.subscriber_phone,t.details,t.completion_notes,t.cancel_reason,t.location_text,ty.name,z.name,(select string_agg(e.full_name,' ') from directory e where e.id=any(public.task_member_ids(t.assignee_id,t.assignee_ids))),case when cardinality(public.task_member_ids(t.assignee_id,t.assignee_ids))>1 then 'مهمة مشتركة' else '' end,case t.status when 'done' then 'أُنجزت منجزة' when 'cancelled' then 'ألغيت ملغية' when 'in_progress' then 'قيد التنفيذ' when 'sent' then 'أرسلت' else 'لم ترسل' end)),q)=0)
 order by t.number desc,t.id limit greatest(1,least(coalesce(p_limit,50),100)) offset greatest(0,coalesce(p_offset,0))
$$;
do $$ declare f text;begin foreach f in array array['task_sms_units(text)','task_sms_trim(text)','task_member_ids(uuid,uuid[])','shared_task_sms_text(uuid)','task_send_shared_sms(uuid,uuid,uuid[])','task_search_fold(text)','task_search(text,integer,integer)'] loop
 execute 'revoke all on function public.'||f||' from public,anon';execute 'grant execute on function public.'||f||' to authenticated';
end loop;end $$;
notify pgrst,'reload schema';

-- The day selected by the office also selects the matrix and its printed statement.
create or replace function public.tasks_for_day(p_day date,p_offset integer default 0,p_limit integer default 500) returns setof public.tasks
language sql stable set search_path=public as $$
 select t.* from public.tasks t where p_day in ((t.created_at at time zone 'Asia/Gaza')::date,(t.completed_at at time zone 'Asia/Gaza')::date,(t.cancelled_at at time zone 'Asia/Gaza')::date)
 order by t.number desc,t.id limit greatest(1,least(coalesce(p_limit,500),1000)) offset greatest(0,coalesce(p_offset,0))
$$;
revoke all on function public.tasks_for_day(date,integer,integer) from public,anon;
grant execute on function public.tasks_for_day(date,integer,integer) to authenticated;
