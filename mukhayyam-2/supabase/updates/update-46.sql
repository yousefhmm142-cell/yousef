-- Update 46: exact-day matching of historical and new work.
-- Match old and new completed work on the Gaza day, holder, subscriber and work.
-- No task, seal, time or work description is deleted or renamed.
create or replace function m2_ops.work_match_text(v text) returns text
language sql immutable set search_path=public as $$
 select lower(btrim(regexp_replace(translate(regexp_replace(coalesce(v,''),'[ًٌٍَُِّْٰـ]','','g'),'أإآى','اااي'),'[[:space:]]+',' ','g')))
$$;
create or replace function m2_ops.work_match_kind(v text) returns text
language sql stable set search_path=public as $$
 select coalesce((select m2_ops.work_match_text(name) from task_types
 where m2_ops.work_match_text(v)=m2_ops.work_match_text(name)
 or m2_ops.work_match_text(v) like m2_ops.work_match_text(name)||' %'
 order by length(name) desc,id limit 1),m2_ops.work_match_text(v))
$$;
create or replace function m2_ops.work_match_set(v text) returns text
language sql stable set search_path=public as $$
 select string_agg(k,' + ' order by k) from (select distinct m2_ops.work_match_kind(x) k from regexp_split_to_table(coalesce(v,''),'[[:space:]]*\+[[:space:]]*') x where btrim(x)<>'') q
$$;
create or replace function m2_ops.seal_matches_job(s public.seals,t public.tasks) returns boolean
language plpgsql stable set search_path=public as $$
declare body text:=m2_ops.work_match_text(s.details);sub text:=m2_ops.work_match_text(t.subscriber_name);m text[];work text;pos integer;
begin
 if s.status<>'used' or t.status<>'done' or s.technician_id is null or sub='' or t.completed_at is null
 or coalesce(s.used_on,s.issued_on) is distinct from (t.completed_at at time zone 'Asia/Gaza')::date
 or not(s.technician_id=any(public.task_member_ids(t.assignee_id,t.assignee_ids))) then return false;end if;
 m:=regexp_match(body,'\(([^()]*)\)[[:space:]]*$');
 if m is not null then
  if m2_ops.work_match_text(m[1])<>sub then return false;end if;
  body:=btrim(regexp_replace(body,'\([^()]*\)[[:space:]]*$',''));
 else
  if right(body,length(sub)+1)<>' '||sub then return false;end if;
  body:=btrim(left(body,length(body)-length(sub)-1));
 end if;
 -- A board prefix is metadata, not a work name. Stop at the first known work.
 if body ~ '^طبلون(?:ات)?[[:space:]]' then
  select min(strpos(' '||body||' ',' '||m2_ops.work_match_text(name)||' ')) into pos from task_types
  where strpos(' '||body||' ',' '||m2_ops.work_match_text(name)||' ')>0;
  if pos is null then return false;end if;
  body:=btrim(substr(body,pos));
 end if;
 select coalesce(nullif(t.completed_work,''),name) into work from task_types where id=t.task_type_id;
 -- Legacy text without brackets must also match the entire work; a shorter subscriber
 -- must never be mistaken for the tail of someone else's longer name.
 if m is null and m2_ops.work_match_text(body)<>m2_ops.work_match_text(work) then return false;end if;
 return nullif(m2_ops.work_match_set(body),'')=nullif(m2_ops.work_match_set(work),'');
end $$;
create index if not exists tasks_done_match_day on public.tasks(((completed_at at time zone 'Asia/Gaza')::date)) where status='done';
create index if not exists seals_used_match_day on public.seals(coalesce(used_on,issued_on),technician_id) where status='used' and task_id is null;

-- Row locks are skipped on contention; the minute reconciliation retries those rows.
-- A private helper, not an RPC granting accountants any task-management access.
create or replace function m2_ops.link_matching_work(p_seal integer default null,p_task uuid default null) returns integer
language plpgsql security definer set search_path=public as $$
declare s public.seals;candidate uuid;matches integer;linked integer:=0;
begin
 if coalesce(current_setting('m2.auto_linking',true),'')='yes' then return 0;end if;
 perform set_config('m2.auto_linking','yes',true);
 for s in select x.* from seals x where x.status='used' and x.task_id is null and x.technician_id is not null
 and (p_seal is null or x.seal_no=p_seal)
 and (p_task is null or exists(select 1 from tasks t where t.id=p_task and m2_ops.seal_matches_job(x,t)))
 order by x.seal_no for update skip locked loop
  select count(*),(array_agg(t.id order by t.id))[1] into matches,candidate from tasks t
  where t.status='done' and (t.completed_at at time zone 'Asia/Gaza')::date=coalesce(s.used_on,s.issued_on) and m2_ops.seal_matches_job(s,t);
  if matches<>1 then continue;end if;
  perform 1 from tasks where id=candidate for update skip locked;
  if not found then continue;end if;
  -- Re-evaluate after waiting/locking: never pick one of multiple matching orders.
  if (select count(*) from tasks t where t.status='done' and (t.completed_at at time zone 'Asia/Gaza')::date=coalesce(s.used_on,s.issued_on) and m2_ops.seal_matches_job(s,t))<>1 then continue;end if;
  update seals set task_id=candidate where seal_no=s.seal_no and task_id is null;
  linked:=linked+1;
 end loop;
 perform set_config('m2.auto_linking','',true);return linked;
end $$;
create or replace function m2_ops.link_work_after_task() returns trigger
language plpgsql security definer set search_path=public as $$ begin
 if new.status='done' then perform m2_ops.link_matching_work(null,new.id);end if;return new;
end $$;
drop trigger if exists tasks_match_seals on public.tasks;
create trigger tasks_match_seals after update of status,completed_work,subscriber_name,assignee_id,assignee_ids on public.tasks
for each row execute function m2_ops.link_work_after_task();
create or replace function m2_ops.link_work_after_seal() returns trigger
language plpgsql security definer set search_path=public as $$ begin
 if new.status='used' and new.task_id is null then perform m2_ops.link_matching_work(new.seal_no,null);end if;return new;
end $$;
drop trigger if exists seals_match_tasks on public.seals;
create trigger seals_match_tasks after insert or update of status,details,used_on,technician_id on public.seals
for each row execute function m2_ops.link_work_after_seal();

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
 if p_task is null and p_status='used' then perform m2_ops.link_matching_work(p_seal,null);end if;
end $$;


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
 update tasks set used_seals=coalesce((select array_agg(seal_no order by seal_no) from seals where task_id=p_task and status='used'),'{}') where id=p_task;
 perform set_config('m2.link_seal','',true);
 insert into task_completion_receipts(operation,task_id,actor_id) values(p_operation,p_task,me);
end $$;


-- The same conservative reconciliation applies to historical records, without touching explicit links.
select m2_ops.link_matching_work();
-- Resolve simultaneous offline synchronizations without blocking staff transactions.
do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.schedule('m2-link-task-seals','* * * * *','select m2_ops.link_matching_work()');
 end if;
end $$;
revoke all on function m2_ops.work_match_text(text),m2_ops.work_match_kind(text),m2_ops.work_match_set(text),m2_ops.seal_matches_job(public.seals,public.tasks),m2_ops.link_matching_work(integer,uuid),m2_ops.link_work_after_task(),m2_ops.link_work_after_seal() from public,anon,authenticated;
notify pgrst,'reload schema';
