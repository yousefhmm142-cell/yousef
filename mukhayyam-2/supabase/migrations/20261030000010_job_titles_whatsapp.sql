-- =====================================================================
--  نظام مخيم 2: المسمى الوظيفي + مقدمة الواتساب لكل موظف
-- =====================================================================
-- job_title: what the person does in the office (نائب المدير، محاسبة، فني...), shown instead of the
--            system role where it is set.
-- wa_code:   the country code their WhatsApp was registered with. Palestinian numbers are on
--            WhatsApp as +972 or +970, and a wa.me link only opens with the right one.

alter table public.employees add column if not exists job_title text check (job_title is null or length(job_title) <= 60);
alter table public.employees add column if not exists wa_code smallint not null default 972 check (wa_code in (970, 972));

create or replace function public.admin_set_profile(p_id uuid, p_job_title text, p_wa_code smallint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.employees
     set job_title = nullif(btrim(coalesce(p_job_title, '')), ''),
         wa_code = coalesce(p_wa_code, wa_code)
   where id = p_id;
  if not found then raise exception 'missing'; end if;
end $$;

revoke execute on function public.admin_set_profile(uuid, text, smallint) from anon, public;
grant execute on function public.admin_set_profile(uuid, text, smallint) to authenticated;

notify pgrst, 'reload schema';
