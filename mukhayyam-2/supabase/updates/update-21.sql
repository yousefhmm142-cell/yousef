-- تحديث 21: إضافة كشف أعمال الأختام إلى الصفحات القابلة للتفعيل من الصلاحيات.
-- =====================================================================
--  نظام مخيم 2: صلاحية مستقلة لكشف أعمال الأختام، يفتحها المدير لمن يختار
-- =====================================================================
-- Keeps existing task/report summaries working; grants statement-only readers no seals editing access.
-- No existing employee is granted a new page automatically. Safe to apply more than once.

create or replace function public.admin_set_pages(p_id uuid, p_pages text[]) returns void
language plpgsql security definer set search_path = public as $$
declare v text[];
begin
  if not public.is_manager() then raise exception 'not_allowed' using errcode = '42501'; end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v
    from unnest(coalesce(p_pages, '{}')) as x
   where x in ('generation', 'distribution', 'tasks', 'attendance', 'stock', 'seal-work');
  update public.employees set pages = v where id = p_id;
  if not found then raise exception 'missing'; end if;
end $$;

revoke execute on function public.has_page(text), public.admin_set_pages(uuid, text[]) from anon, public;
grant execute on function public.has_page(text), public.admin_set_pages(uuid, text[]) to authenticated;


create or replace function public.seal_work_statement(p_from date, p_to date)
returns table (seal_no integer, technician_id uuid, used_on date, issued_on date, details text, board_no text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_manager() or public.has_seals() or public.has_page('tasks') or public.has_page('reports') or public.has_page('seal-work')) then
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
