-- Only the preparation signal, with its actual audit actor; never expose row snapshots.
create or replace function public.prepared_task_notifications(p_limit integer default 80)
returns table(id bigint,at timestamptz,task_id uuid,task_number bigint,who text)
language plpgsql stable security definer set search_path=public as $$
begin
 if not public.has_page('tasks') then raise exception 'not_allowed' using errcode='42501';end if;
 return query
 select a.id,a.at,t.id,t.number::bigint,coalesce(e.full_name,'النظام')
 from public.audit_log a
 join public.tasks t on t.id::text=a.record_id
 left join public.employees e on e.id=a.actor_id
 where a.table_name='tasks' and a.action='insert'
 and a.new_row->>'status'='new'
 and nullif(a.new_row->>'assignee_id','') is null
 and coalesce(a.new_row->'assignee_ids','[]'::jsonb) in ('[]'::jsonb,'null'::jsonb)
 order by a.id desc limit greatest(1,least(coalesce(p_limit,80),100));
end $$;
revoke all on function public.prepared_task_notifications(integer) from public,anon;
grant execute on function public.prepared_task_notifications(integer) to authenticated;
notify pgrst,'reload schema';
