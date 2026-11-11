-- =====================================================================
--  نظام مخيم 2: التحديث 42 · ملف المشترك (مهامه وأختامه وقراءاته بمكان واحد)
--  يُطبَّق تلقائياً مع الرفع (أو الصقه في Supabase > SQL Editor ثم Run). تكراره لا يضر.
-- =====================================================================
-- One call for one subscriber: the directory line(s), the tasks done for him (by name or phone), the seals
-- recorded on his name or board, and his meter readings week by week. Names are compared folded
-- (hamza, taa marbuta, ya, both digit alphabets, spaces), boards without spaces.
-- For the manager and whoever has the tasks page.

create or replace function public.subscriber_profile(p_name text, p_board text default null, p_phone text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  n text := public.task_search_fold(p_name);
  b text := nullif(regexp_replace(public.task_search_fold(p_board), '\s+', '', 'g'), '');
  ph text := case when p_phone ~ '^05[0-9]{8}$' then p_phone end;
begin
  if not (public.is_manager() or public.has_page('tasks')) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if length(n) < 2 then raise exception 'short_name'; end if;
  return jsonb_build_object(
    'directory', (
      select coalesce(jsonb_agg(jsonb_build_object('name', s.full_name, 'area', s.area, 'board', s.board, 'phone', s.phone) order by s.id), '[]'::jsonb)
        from (select * from public.subscribers s
               where public.task_search_fold(s.full_name) = n or (ph is not null and s.phone = ph) limit 5) s),
    'tasks', (
      select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) from (
        select jsonb_build_object(
                 'id', t.id, 'number', t.number, 'type', ty.name, 'status', t.status, 'details', t.details,
                 'created_at', t.created_at, 'completed_at', t.completed_at, 'notes', t.completion_notes,
                 'who', (select string_agg(e.full_name, '، ') from public.employees e where e.id = any(public.task_member_ids(t.assignee_id, t.assignee_ids)))) x
          from public.tasks t left join public.task_types ty on ty.id = t.task_type_id
         where public.task_search_fold(t.subscriber_name) = n or (ph is not null and t.subscriber_phone = ph)
         order by t.created_at desc limit 60) q),
    'seals', (
      select coalesce(jsonb_agg(x order by x->>'used_on' desc nulls last), '[]'::jsonb) from (
        select jsonb_build_object('seal_no', s.seal_no, 'status', s.status, 'used_on', s.used_on, 'details', s.details, 'board', s.board_no,
                                  'who', (select e.full_name from public.employees e where e.id = s.technician_id)) x
          from public.seals s
         where s.status in ('used', 'damaged', 'lost')
           and ((b is not null and regexp_replace(public.task_search_fold(s.board_no), '\s+', '', 'g') = b)
             or (position(' ' in n) > 0 and strpos(public.task_search_fold(s.details), n) > 0))
         order by s.used_on desc nulls last limit 60) q),
    'readings', (
      select coalesce(jsonb_agg(x order by x->>'period_to' desc nulls last), '[]'::jsonb) from (
        select jsonb_build_object('week', rb.title, 'period_to', rb.period_to, 'code', r.code, 'board', r.board, 'prev', r.prev,
                                  'reading', r.reading, 'state', r.state, 'at', r.entered_at) x
          from public.reading_rows r join public.reading_batches rb on rb.id = r.batch_id
         where public.task_search_fold(r.subscriber) = n
           and (b is null or regexp_replace(public.task_search_fold(r.board), '\s+', '', 'g') = b or r.board = '')
         order by rb.period_to desc nulls last, rb.created_at desc limit 30) q)
  );
end $$;
revoke execute on function public.subscriber_profile(text, text, text) from anon, public;
grant execute on function public.subscriber_profile(text, text, text) to authenticated;

notify pgrst, 'reload schema';
