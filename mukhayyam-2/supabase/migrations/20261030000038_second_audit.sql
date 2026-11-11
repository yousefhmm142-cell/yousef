-- Second audit batch: restricted staff directory, opt-in cold archives, and an Auth hook.
-- No historical data is deleted by installation. Archives require a separate manager action.

alter policy employees_read on public.employees
  using (public.is_manager() or id = public.current_employee_id());

create or replace function public.employee_directory() returns setof public.employees
language plpgsql stable security definer set search_path=public as $$
declare me uuid:=public.current_employee_id(); office boolean; dispatcher boolean;
begin
 if me is null then raise exception 'not_allowed' using errcode='42501'; end if;
 office:=public.has_role('generation_operator','distribution_supervisor') or public.has_page('tasks') or public.has_page('attendance') or public.has_page('reports') or public.has_page('generation') or public.has_page('distribution') or public.has_page('readings-admin');
 dispatcher:=public.has_page('tasks');
 return query select (case when public.is_manager() or e.id=me then e else jsonb_populate_record(null::public.employees,jsonb_build_object(
  'id',e.id,'full_name',e.full_name,'role',e.role,'is_active',e.is_active,'deleted_at',e.deleted_at,'job_title',e.job_title,
  'phone',case when dispatcher and e.role='technician' and e.is_active and e.deleted_at is null then e.phone else null end,
  'tracks_attendance',case when public.has_page('attendance') or public.has_page('reports') then e.tracks_attendance else false end,
  'schedule_id',case when public.has_page('attendance') or public.has_page('reports') then e.schedule_id else null end,
  'can_seals',false,'seals_sheet',case when public.has_seals() then e.seals_sheet else null end,'pages',case when public.has_page('readings-admin') and e.role='technician' and 'readings'=any(coalesce(e.pages,'{}')) then '["readings"]'::jsonb else '[]'::jsonb end,'auth_user_id',null,'wa_code',e.wa_code)) end).*
 from public.employees e where public.is_manager() or e.id=me or ((
  (office and (e.role in ('admin','manager','generation_operator','distribution_supervisor','technician') or public.has_page('attendance') or public.has_page('reports')))
  or (public.has_seals() and e.role='technician')
  or ((office or public.has_seals()) and e.job_title in ('مدير الموقع','مدير المكتب')))) order by e.full_name,e.id;
end $$;
revoke all on function public.employee_directory() from public,anon;
grant execute on function public.employee_directory() to authenticated;

-- Hook must also be enabled in Supabase Auth settings. It does not revoke existing sessions.
create table if not exists m2_ops.login_attempts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 started_at timestamptz not null, failures integer not null default 0,
 blocked_until timestamptz
);
revoke all on m2_ops.login_attempts from public,anon,authenticated;
create or replace function public.password_verification_attempt_hook(event jsonb) returns jsonb
language plpgsql security definer set search_path=public,m2_ops as $$
declare who uuid; valid boolean; a m2_ops.login_attempts%rowtype; moment timestamptz:=clock_timestamp();
begin
 who:=(event->>'user_id')::uuid;valid:=(event->>'valid')::boolean;
 if who is null or valid is null or not exists(select 1 from auth.users where id=who) then return jsonb_build_object('decision','reject','message','تعذّر الدخول','should_logout_user',false);end if;
 perform pg_advisory_xact_lock(hashtextextended('m2-login:'||who::text,0));
 delete from m2_ops.login_attempts where started_at<moment-interval '1 day' and coalesce(blocked_until,moment-interval '1 second')<moment;
 insert into m2_ops.login_attempts(user_id,started_at) values(who,moment) on conflict do nothing;
 select * into a from m2_ops.login_attempts where user_id=who for update;
 if a.blocked_until>moment then return jsonb_build_object('decision','reject','message','محاولات كثيرة. استنى ربع ساعة وحاول من جديد.','should_logout_user',false);end if;
 if valid then delete from m2_ops.login_attempts where user_id=who;return jsonb_build_object('decision','continue');end if;
 if a.started_at<=moment-interval '15 minutes' then a.failures:=0;a.started_at:=moment;end if;
 a.failures:=a.failures+1;
 update m2_ops.login_attempts set started_at=a.started_at,failures=a.failures,blocked_until=case when a.failures>=5 then moment+interval '15 minutes' else null end where user_id=who;
 if a.failures>=5 then return jsonb_build_object('decision','reject','message','محاولات كثيرة. استنى ربع ساعة وحاول من جديد.','should_logout_user',false);end if;
 return jsonb_build_object('decision','continue');
end $$;
revoke all on function public.password_verification_attempt_hook(jsonb) from public,anon,authenticated;
do $$ begin if exists(select 1 from pg_roles where rolname='supabase_auth_admin') then
 grant usage on schema public to supabase_auth_admin;
 grant execute on function public.password_verification_attempt_hook(jsonb) to supabase_auth_admin;
end if;end $$;

-- Archive receipts tie cleanup to exactly the records offered for download, for one manager/day.
create table if not exists m2_ops.archive_receipts (
 id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employees(id),
 kind text not null check(kind in ('audit','reading')),batch_id uuid,ids bigint[],fingerprint text not null,
 created_at timestamptz not null default now(),consumed_at timestamptz
);
revoke all on m2_ops.archive_receipts from public,anon,authenticated;
alter table public.reading_files add column if not exists archived_at timestamptz;
alter table public.reading_files add column if not exists archived_digest text;
alter table public.reading_batches add column if not exists archived_at timestamptz;
alter table public.reading_batches add column if not exists archived_digest text;
create index if not exists audit_log_retention on public.audit_log(at,id);

create or replace function public.storage_overview() returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_manager() then raise exception 'not_allowed' using errcode='42501';end if;
 return jsonb_build_object('audit_count',(select count(*) from public.audit_log),
 'old_audit_count',(select count(*) from public.audit_log where at<now()-interval '1 year'),
 'audit_bytes',(select pg_total_relation_size('public.audit_log')),
 'reading_bytes',(select coalesce(sum(octet_length(source_b64)),0) from public.reading_files),
 'batches',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'title',b.title,'date',coalesce(b.period_to,b.created_at::date),'archived',b.archived_at is not null,'files',(select count(*) from public.reading_files f where f.batch_id=b.id),'bytes',coalesce(octet_length(b.source_b64),0)+(select coalesce(sum(octet_length(f.source_b64)),0) from public.reading_files f where f.batch_id=b.id)) order by coalesce(b.period_to,b.created_at::date)), '[]'::jsonb) from public.reading_batches b where b.status='approved' and coalesce(b.period_to,b.created_at::date)<current_date-365));
end $$;

create or replace function public.prepare_cold_archive(p_kind text,p_batch uuid default null) returns jsonb
language plpgsql security definer set search_path=public,m2_ops as $$
declare receipt uuid; who uuid:=public.current_employee_id(); ids bigint[]; data jsonb; fingerprint text; b public.reading_batches%rowtype;
begin
 if not public.is_manager() then raise exception 'not_allowed' using errcode='42501';end if;
 delete from m2_ops.archive_receipts where created_at<now()-interval '1 day';
 if (select count(*) from m2_ops.archive_receipts where employee_id=who and consumed_at is null)>=20 then raise exception 'archive_limit';end if;
 if p_kind='audit' then
  select array_agg(x.id order by x.id),md5(string_agg(x.id::text||':'||md5(to_jsonb(x)::text),',' order by x.id)),
    jsonb_agg(jsonb_build_object('id',x.id,'table_name',x.table_name,'record_id',x.record_id,'action',x.action,'actor_id',x.actor_id,'at',x.at,'text',public.activity_label(x.table_name,x.action,x.old_row,x.new_row),'old_row',x.old_row-array['pin','password','token','link_token','source_b64','auth_user_id','code','data'],'new_row',x.new_row-array['pin','password','token','link_token','source_b64','auth_user_id','code','data']) order by x.id)
   into ids,fingerprint,data from (select * from public.audit_log where at<now()-interval '1 year' order by id limit 5000) x;
  if ids is null then raise exception 'nothing_to_archive';end if;
 elsif p_kind='reading' then
  select * into b from public.reading_batches where id=p_batch for update;
  if b.id is null or b.status<>'approved' or coalesce(b.period_to,b.created_at::date)>=current_date-365 or b.archived_at is not null then raise exception 'archive_not_allowed';end if;
  perform 1 from public.reading_files where batch_id=p_batch for update;
  perform 1 from public.reading_rows where batch_id=p_batch for share;
  data:=jsonb_build_object('batch',to_jsonb(b),'files',(select coalesce(jsonb_agg(to_jsonb(f) order by id),'[]'::jsonb) from public.reading_files f where batch_id=p_batch),'rows',(select coalesce(jsonb_agg(to_jsonb(r) order by ord),'[]'::jsonb) from public.reading_rows r where batch_id=p_batch));
  fingerprint:=md5(data::text);
 else raise exception 'archive_not_allowed';end if;
 insert into m2_ops.archive_receipts(employee_id,kind,batch_id,ids,fingerprint) values(who,p_kind,p_batch,ids,fingerprint) returning id into receipt;
 return jsonb_build_object('app','mukhayyam2','kind',p_kind,'version',1,'receipt',receipt,'data',data);
end $$;

create or replace function public.finish_cold_archive(p_receipt uuid) returns integer
language plpgsql security definer set search_path=public,m2_ops as $$
declare r m2_ops.archive_receipts%rowtype; actual text; b public.reading_batches%rowtype; data jsonb; affected integer;
begin
 if not public.is_manager() then raise exception 'not_allowed' using errcode='42501';end if;
 select * into r from m2_ops.archive_receipts where id=p_receipt and employee_id=public.current_employee_id() and consumed_at is null and created_at>now()-interval '1 day' for update;
 if r.id is null then raise exception 'archive_expired';end if;
 if r.kind='audit' then
  select md5(string_agg(x.id::text||':'||md5(to_jsonb(x)::text),',' order by x.id)) into actual from public.audit_log x where x.id=any(r.ids) and x.at<now()-interval '1 year';
  if actual is distinct from r.fingerprint then raise exception 'archive_changed';end if;
  delete from public.audit_log where id=any(r.ids);get diagnostics affected=row_count;
 else
  select * into b from public.reading_batches where id=r.batch_id for update;
  if b.status<>'approved' or coalesce(b.period_to,b.created_at::date)>=current_date-365 or b.archived_at is not null then raise exception 'archive_changed';end if;
  perform 1 from public.reading_files where batch_id=r.batch_id for update;
  perform 1 from public.reading_rows where batch_id=r.batch_id for share;
  data:=jsonb_build_object('batch',to_jsonb(b),'files',(select coalesce(jsonb_agg(to_jsonb(f) order by id),'[]'::jsonb) from public.reading_files f where batch_id=r.batch_id),'rows',(select coalesce(jsonb_agg(to_jsonb(x) order by ord),'[]'::jsonb) from public.reading_rows x where batch_id=r.batch_id));
  if md5(data::text)<>r.fingerprint then raise exception 'archive_changed';end if;
  update public.reading_files set archived_digest=md5(source_b64),source_b64='',archived_at=now() where batch_id=r.batch_id;get diagnostics affected=row_count;
  update public.reading_batches set archived_digest=md5(coalesce(source_b64,'')),source_b64=null,archived_at=now() where id=r.batch_id;
 end if;
 update m2_ops.archive_receipts set consumed_at=now() where id=r.id;
 insert into public.audit_log(table_name,record_id,action,actor_id,new_row) values('cold_archive',r.id::text,'update',public.current_employee_id(),jsonb_build_object('kind',r.kind,'count',affected,'batch_id',r.batch_id));
 return affected;
end $$;

create or replace function public.restore_reading_archive(p_archive jsonb) returns integer
language plpgsql security definer set search_path=public as $$
declare b public.reading_batches%rowtype; f public.reading_files%rowtype; v jsonb; batch uuid; count_files integer:=0;
begin
 if not public.is_manager() then raise exception 'not_allowed' using errcode='42501';end if;
 if p_archive->>'app'<>'mukhayyam2' or p_archive->>'kind'<>'reading' or p_archive->>'version'<>'1' then raise exception 'invalid_archive';end if;
 batch:=(p_archive#>>'{data,batch,id}')::uuid;
 select * into b from public.reading_batches where id=batch for update;
 if b.archived_at is null then raise exception 'invalid_archive';end if;
 if md5(coalesce(p_archive#>>'{data,batch,source_b64}','')) is distinct from b.archived_digest then raise exception 'invalid_archive';end if;
 for f in select * from public.reading_files where batch_id=batch for update loop
  select x into v from jsonb_array_elements(p_archive#>'{data,files}') x where x->>'id'=f.id::text;
  if v is null or md5(coalesce(v->>'source_b64','')) is distinct from f.archived_digest then raise exception 'invalid_archive';end if;
  update public.reading_files set source_b64=v->>'source_b64',archived_at=null,archived_digest=null where id=f.id;
  count_files:=count_files+1;
 end loop;
 update public.reading_batches set source_b64=p_archive#>>'{data,batch,source_b64}',archived_at=null,archived_digest=null where id=batch;
 return count_files;
end $$;

do $$ declare f text; begin foreach f in array array['storage_overview()','prepare_cold_archive(text,uuid)','finish_cold_archive(uuid)','restore_reading_archive(jsonb)'] loop
 execute 'revoke all on function public.'||f||' from public,anon';
 execute 'grant execute on function public.'||f||' to authenticated';
end loop;end $$;

-- Never multiply file bodies or authentication credentials into change snapshots.
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path=public as $$
declare o jsonb:=case when tg_op<>'INSERT' then to_jsonb(old) end;
 n jsonb:=case when tg_op<>'DELETE' then to_jsonb(new) end;
 private_keys text[]:=array['source_b64','link_token','token','pin','password','encrypted_password','auth_user_id'];
 ref text:=coalesce(coalesce(n,o)->>'id',coalesce(n,o)->>'seal_no');
begin
 if tg_op='UPDATE' and (o-'updated_at')=(n-'updated_at') then return new;end if;
 if tg_table_name='attendance_points' then private_keys:=private_keys||'code'::text;end if;
 insert into public.audit_log(table_name,record_id,action,actor_id,old_row,new_row)
 values(tg_table_name,ref,lower(tg_op),public.current_employee_id(),o-private_keys,n-private_keys);
 return coalesce(new,old);
end $$;
