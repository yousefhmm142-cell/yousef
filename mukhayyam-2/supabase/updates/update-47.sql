-- Update 47: holder-scoped task picker and safe prefill.
-- Safe accountant projection: completed tasks of this seal's actual holder only.
-- No employee phones, private task links, or general task management access.
create index if not exists subscribers_work_name_key on public.subscribers(m2_ops.work_match_text(full_name));

drop function if exists public.seal_task_candidates(integer);
create function public.seal_task_candidates(p_seal integer)
returns table(id uuid,number bigint,subscriber text,work text,completed_at timestamptz,technician_id uuid,board text,completed_on date)
language plpgsql stable security definer set search_path=public as $$ begin
 if not public.has_seals() then raise exception 'not_allowed' using errcode='42501';end if;
 return query
 select t.id,t.number::bigint,t.subscriber_name,coalesce(nullif(t.completed_work,''),ty.name),t.completed_at,s.technician_id,
 coalesce(nullif(public.seal_board_no(t.location_text),''),
   case when btrim(t.location_text) ~ '^[0-9]+[A-Za-z]?$' then btrim(t.location_text) end,
   (select min(x.board_no) from seals x where x.task_id=t.id and x.status='used' and nullif(btrim(x.board_no),'') is not null having count(distinct btrim(x.board_no))=1),
   (select min(x.board) from subscribers x where m2_ops.work_match_text(x.full_name)=m2_ops.work_match_text(t.subscriber_name) and nullif(btrim(x.board),'') is not null having count(distinct btrim(x.board))=1),''),
 (t.completed_at at time zone 'Asia/Gaza')::date
 from tasks t join task_types ty on ty.id=t.task_type_id
 join seals s on s.seal_no=p_seal
 where s.technician_id is not null and t.status='done'
 and s.technician_id=any(public.task_member_ids(t.assignee_id,t.assignee_ids))
 order by (t.id=s.task_id) desc,t.completed_at desc,t.id limit 100;
end $$;
revoke all on function public.seal_task_candidates(integer) from public,anon;
grant execute on function public.seal_task_candidates(integer) to authenticated;
notify pgrst,'reload schema';
