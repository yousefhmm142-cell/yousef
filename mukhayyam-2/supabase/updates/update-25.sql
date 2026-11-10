-- =====================================================================
--  نظام مخيم 2: التحديث 25 · دليل المشتركين لتعبئة المهام
--  يُطبَّق تلقائياً مع الرفع (أو الصقه في Supabase > SQL Editor ثم Run). تكراره لا يضر.
-- =====================================================================

create table if not exists public.subscribers (
  id bigint generated always as identity primary key,
  full_name text not null check (length(btrim(full_name)) between 2 and 120),
  area text,
  board text,
  phone text,
  created_at timestamptz not null default now()
);
alter table public.subscribers enable row level security;
drop policy if exists subscribers_read on public.subscribers;
create policy subscribers_read on public.subscribers for select to authenticated
  using (public.is_manager() or public.has_page('tasks') or public.has_seals());
revoke all on public.subscribers from anon;
grant select on public.subscribers to authenticated;

-- The whole list at once: [{"n": name, "a": area, "b": board, "p": phone}, ...]
create or replace function public.subscribers_import(p jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  if not public.is_manager() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p) <> 'array' then raise exception 'bad_file'; end if;
  delete from public.subscribers where true;
  insert into public.subscribers (full_name, area, board, phone)
  select btrim(x ->> 'n'), nullif(btrim(x ->> 'a'), ''), nullif(btrim(x ->> 'b'), ''), nullif(regexp_replace(coalesce(x ->> 'p', ''), '[^0-9]', '', 'g'), '')
    from jsonb_array_elements(p) x
   where length(btrim(coalesce(x ->> 'n', ''))) between 2 and 120;
  get diagnostics v = row_count;
  return v;
end $$;
revoke execute on function public.subscribers_import(jsonb) from anon, public;
grant execute on function public.subscribers_import(jsonb) to authenticated;

notify pgrst, 'reload schema';
