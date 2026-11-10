-- Reuse immutable audit references, without exposing private row snapshots to the UI.
alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check check (action in ('insert','update','delete'));
create index if not exists audit_log_recent on public.audit_log (id desc);
do $$ declare t text; begin
 foreach t in array array['seal_rolls','seal_batches','tasks','attendance_punches','leaves','site_reports','distribution_sheets','reading_batches'] loop
  execute format('drop trigger if exists %I on public.%I',t||'_audit_insert',t);
  execute format('create trigger %I after insert on public.%I for each row execute function public.audit_row()',t||'_audit_insert',t);
 end loop;
end $$;

drop trigger if exists reading_rows_activity_audit on public.reading_rows;
create trigger reading_rows_activity_audit after update of reading on public.reading_rows for each row when (old.reading is distinct from new.reading) execute function public.audit_row();

create or replace function public.activity_label(p_table text,p_action text,p_old jsonb,p_new jsonb)
returns text language plpgsql immutable set search_path=public as $$
declare r jsonb:=coalesce(p_new,p_old); verb text:=case p_action when 'insert' then 'أضاف' when 'delete' then 'حذف' else 'عدّل' end;
begin return case p_table
 when 'seal_rolls' then verb||' رول أختام '||coalesce(r->>'from_no','')||'–'||coalesce(r->>'to_no','')
 when 'seal_batches' then verb||' دفعة أختام #'||coalesce(r->>'batch_no','')
 when 'seals' then case when p_action='delete' then 'حذف' when r->>'status'='used' then 'سجّل استخدام' when r->>'status'='issued' then case when p_old->>'status'='used' then 'ألغى تسجيل استخدام' else 'صرف' end when r->>'status'='in_stock' then 'أعاد للمخزن' else 'عدّل حالة' end||' الختم '||coalesce(r->>'seal_no','')||case when nullif(r->>'details','') is not null then ' · '||left(r->>'details',160) else '' end
 when 'tasks' then case when r->>'status'='done' then 'أنهى' when r->>'status'='cancelled' then 'ألغى' when r->>'status'='in_progress' then 'بدأ' else verb end||' مهمة #'||coalesce(r->>'number','')||case when nullif(r->>'subscriber_name','') is not null then ' · '||left(r->>'subscriber_name',100) else '' end
 when 'attendance_punches' then case when p_action='delete' then 'حذف تسجيل حضور' when r->>'kind'='in' then 'سجّل حضور' else 'سجّل انصراف' end
 when 'leaves' then verb||' إجازة'
 when 'site_reports' then case when r->>'status'='approved' then 'اعتمد' when r->>'status'='submitted' then 'أرسل' else verb end||' تقرير التوليد · '||coalesce(r->>'report_date','')
 when 'distribution_sheets' then case when r->>'status'='approved' then 'اعتمد' when r->>'status'='submitted' then 'أرسل' else verb end||' كشف التوزيع · '||coalesce(r->>'sheet_date','')
 when 'reading_batches' then verb||' كشف قراءات · '||left(coalesce(r->>'title',''),100)
 when 'reading_rows' then 'سجّل قراءة · '||left(coalesce(r->>'subscriber',''),100)
 when 'employees' then verb||' بيانات موظف'
 when 'app_settings' then 'حدّث إعدادات المكتب'
 when 'generators' then verb||' مولد'
 when 'zones' then verb||' منطقة توزيع'
 when 'task_types' then verb||' نوع مهمة'
 when 'work_schedules' then 'عدّل مواعيد الدوام'
 else verb||' سجل' end;
end $$;
revoke all on function public.activity_label(text,text,jsonb,jsonb) from public,anon,authenticated;

create or replace function public.recent_activity(p_limit integer default 80)
returns table(id bigint,at timestamptz,kind text,who text,text text,tone text,route text)
language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_manager() then raise exception 'not_allowed' using errcode='42501'; end if;
 return query select a.id,a.at,
 case when a.table_name in ('seal_rolls','seal_batches','seals') then 'seal' when a.table_name='tasks' then 'task' when a.table_name in ('attendance_punches','leaves') then 'attendance' when a.table_name='site_reports' then 'report' when a.table_name='distribution_sheets' then 'sheet' when a.table_name in ('reading_batches','reading_rows') then 'reading' else 'settings' end,
 coalesce(e.full_name,'النظام'),public.activity_label(a.table_name,a.action,a.old_row,a.new_row)||case when target.id is not null and target.id is distinct from e.id then ' · '||target.full_name else '' end,
 case when a.action='delete' then 'danger' when a.new_row->>'status' in ('done','approved','used') then 'ok' else null end,
 case when a.table_name in ('seal_rolls','seal_batches','seals') then '/seals/log' when a.table_name='tasks' then '/tasks?view=archive' when a.table_name in ('attendance_punches','leaves') then '/attendance' when a.table_name='site_reports' then '/generation' when a.table_name='distribution_sheets' then '/distribution' when a.table_name in ('reading_batches','reading_rows') then '/readings' else '/settings' end
 from public.audit_log a left join public.employees e on e.id=coalesce(a.actor_id,nullif(coalesce(a.new_row,a.old_row)->>'employee_id','')::uuid,case when a.table_name='tasks' then nullif(coalesce(a.new_row,a.old_row)->>'assignee_id','')::uuid end)
 left join public.employees target on target.id=coalesce(nullif(coalesce(a.new_row,a.old_row)->>'employee_id','')::uuid,nullif(coalesce(a.new_row,a.old_row)->>'assignee_id','')::uuid,nullif(coalesce(a.new_row,a.old_row)->>'technician_id','')::uuid)
 where a.table_name in ('seal_rolls','seal_batches','seals','tasks','attendance_punches','leaves','site_reports','distribution_sheets','reading_batches','reading_rows','employees','app_settings','generators','zones','task_types','work_schedules')
 -- Issuing a batch is one notification, rather than one for each seal.
 and not (a.table_name='seals' and a.action='update' and a.old_row->>'status'='in_stock' and a.new_row->>'status'='issued' and exists (select 1 from public.audit_log batch where batch.table_name='seal_batches' and batch.action='insert' and batch.record_id=a.new_row->>'batch_id' and batch.at=a.at))
 and not (a.table_name in ('site_reports','distribution_sheets') and a.action='update' and a.old_row->>'status'=a.new_row->>'status')
 order by a.id desc limit greatest(1,least(coalesce(p_limit,80),200));
end $$;

create or replace function public.seal_activity(p_table text default null,p_record text default null,p_actor uuid default null,p_before bigint default null)
returns table(id bigint,at timestamptz,who text,text text,record_id text,table_name text)
language plpgsql stable security definer set search_path=public as $$
begin
 if not public.has_seals() then raise exception 'not_allowed' using errcode='42501'; end if;
 if p_table is not null and p_table not in ('seal_rolls','seal_batches','seals') then raise exception 'not_allowed' using errcode='42501'; end if;
 return query select a.id,a.at,coalesce(e.full_name,'النظام'),public.activity_label(a.table_name,a.action,a.old_row,a.new_row),a.record_id,a.table_name
 from public.audit_log a left join public.employees e on e.id=a.actor_id
 where a.table_name in ('seal_rolls','seal_batches','seals') and (p_actor is null or a.actor_id=p_actor) and (p_before is null or a.id<p_before)
 and (p_record is null or (a.table_name=p_table and a.record_id=p_record)
 or (p_table='seal_rolls' and (a.old_row->>'roll_id'=p_record or a.new_row->>'roll_id'=p_record))
 or (p_table='seal_batches' and (a.old_row->>'batch_id'=p_record or a.new_row->>'batch_id'=p_record)))
 order by a.id desc limit 100;
end $$;
revoke all on function public.recent_activity(integer),public.seal_activity(text,text,uuid,bigint) from public,anon;
grant execute on function public.recent_activity(integer),public.seal_activity(text,text,uuid,bigint) to authenticated;
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='audit_log') then
 alter publication supabase_realtime add table public.audit_log;
 end if;
end $$;
notify pgrst, 'reload schema';
