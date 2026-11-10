-- =====================================================================
--  نظام مخيم 2: كشف أعمال الفنيين بالأختام (صفحة المهام والتقارير)
-- =====================================================================
-- The seals a technician used, with the day and the work written. Open to those who may see the
-- tasks or the reports as well as to the seals office, without opening the seals tables themselves.

create or replace function public.seal_work_statement(p_from date, p_to date)
returns table (seal_no integer, technician_id uuid, used_on date, issued_on date, details text, board_no text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_manager() or public.has_seals() or public.has_page('tasks') or public.has_page('reports')) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return query
    select s.seal_no, s.technician_id, s.used_on, s.issued_on, s.details, s.board_no
      from public.seals s
     where s.status = 'used' and s.technician_id is not null
       and coalesce(s.used_on, s.issued_on) between coalesce(p_from, date '2000-01-01') and coalesce(p_to, date '2999-12-31')
     order by coalesce(s.used_on, s.issued_on), s.seal_no;
end $$;

revoke execute on function public.seal_work_statement(date, date) from anon, public;
grant execute on function public.seal_work_statement(date, date) to authenticated;

notify pgrst, 'reload schema';
