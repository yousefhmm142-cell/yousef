-- =====================================================================
--  نظام مخيم 2: التحديث 28 · القراءات الأسبوعية (صفحة «القراءات»)
--  يُطبَّق تلقائياً مع الرفع (أو الصقه في Supabase > SQL Editor ثم Run). تكراره لا يضر.
-- =====================================================================

create table if not exists public.reading_batches (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  period_from date,
  period_to date,
  file_name text,
  -- The original file (base64), so the export keeps its sheets, order and formats.
  source_b64 text,
  sheet_name text,
  -- Which column (1-based) gets the current reading in the export.
  current_col integer,
  status text not null default 'open' check (status in ('open', 'approved')),
  created_by uuid references public.employees (id),
  created_at timestamptz not null default now()
);

create table if not exists public.reading_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.reading_batches (id) on delete cascade,
  ord integer not null,
  sheet_row integer not null,
  code text not null default '',
  area text not null default '',
  board text not null default '',
  fak text,
  subscriber text not null default '',
  phone text,
  prev numeric,
  -- How the area is read this week: by a reader in the app, or on a paper sheet.
  mode text check (mode in ('app', 'paper')),
  assignee_id uuid references public.employees (id),
  reading numeric,
  state text check (state in ('disconnected', 'no_meter', 'other', 'unknown')),
  note text,
  source text check (source in ('app', 'paper')),
  entered_by uuid references public.employees (id),
  entered_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (batch_id, ord),
  check (reading is null or state is null),
  check (reading is null or prev is null or reading >= prev)
);
create index if not exists reading_rows_assignee on public.reading_rows (assignee_id, batch_id);
create index if not exists reading_rows_batch on public.reading_rows (batch_id, area, board, ord);

-- Who runs the readings: managers, or whoever was given «مسؤول القراءات».
create or replace function public.is_reading_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager() or public.has_page('readings-admin')
$$;

alter table public.reading_batches enable row level security;
alter table public.reading_rows enable row level security;
drop policy if exists reading_batches_read on public.reading_batches;
create policy reading_batches_read on public.reading_batches for select to authenticated
  using (public.is_reading_admin() or exists (select 1 from public.reading_rows r where r.batch_id = id and r.assignee_id = public.current_employee_id()));
drop policy if exists reading_batches_admin on public.reading_batches;
create policy reading_batches_admin on public.reading_batches for all to authenticated
  using (public.is_reading_admin()) with check (public.is_reading_admin());
drop policy if exists reading_rows_read on public.reading_rows;
create policy reading_rows_read on public.reading_rows for select to authenticated
  using (public.is_reading_admin() or assignee_id = public.current_employee_id());
drop policy if exists reading_rows_insert on public.reading_rows;
create policy reading_rows_insert on public.reading_rows for insert to authenticated with check (public.is_reading_admin());
drop policy if exists reading_rows_delete on public.reading_rows;
create policy reading_rows_delete on public.reading_rows for delete to authenticated using (public.is_reading_admin());
drop policy if exists reading_rows_update on public.reading_rows;
create policy reading_rows_update on public.reading_rows for update to authenticated
  using (public.is_reading_admin() or assignee_id = public.current_employee_id())
  with check (public.is_reading_admin() or assignee_id = public.current_employee_id());
revoke all on public.reading_batches, public.reading_rows from anon;
grant select, insert, update, delete on public.reading_batches, public.reading_rows to authenticated;

-- A reader changes only the reading, the state and the note, only on his own rows, only while the batch is open.
create or replace function public.reading_rows_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.current_employee_id();
  adm boolean := public.is_reading_admin();
begin
  if (select status from public.reading_batches where id = new.batch_id) = 'approved' and not adm then
    raise exception 'batch_closed';
  end if;
  if not adm then
    if old.assignee_id is distinct from me or old.mode is distinct from 'app' then raise exception 'not_yours'; end if;
    if (new.batch_id, new.ord, new.sheet_row, new.code, new.area, new.board, new.fak, new.subscriber, new.phone, new.prev, new.mode, new.assignee_id)
       is distinct from (old.batch_id, old.ord, old.sheet_row, old.code, old.area, old.board, old.fak, old.subscriber, old.phone, old.prev, old.mode, old.assignee_id) then
      raise exception 'not_allowed';
    end if;
    new.source := 'app';
  end if;
  if (new.reading, new.state, new.note) is distinct from (old.reading, old.state, old.note) then
    new.entered_by := me;
    new.entered_at := now();
    if adm and new.source is null then new.source := coalesce(old.mode, 'paper'); end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists reading_rows_guard on public.reading_rows;
create trigger reading_rows_guard before update on public.reading_rows for each row execute function public.reading_rows_guard();

-- Who changed what, for the review.
create table if not exists public.reading_changes (
  id bigint generated always as identity primary key,
  row_id uuid not null references public.reading_rows (id) on delete cascade,
  old_reading numeric, new_reading numeric, old_state text, new_state text,
  by_id uuid references public.employees (id), at timestamptz not null default now()
);
alter table public.reading_changes enable row level security;
drop policy if exists reading_changes_read on public.reading_changes;
create policy reading_changes_read on public.reading_changes for select to authenticated using (public.is_reading_admin());
revoke all on public.reading_changes from anon;
grant select on public.reading_changes to authenticated;
create or replace function public.reading_rows_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.reading, new.state) is distinct from (old.reading, old.state) and (old.reading is not null or old.state is not null) then
    insert into public.reading_changes (row_id, old_reading, new_reading, old_state, new_state, by_id)
    values (new.id, old.reading, new.reading, old.state, new.state, public.current_employee_id());
  end if;
  return new;
end $$;
drop trigger if exists reading_rows_log on public.reading_rows;
create trigger reading_rows_log after update on public.reading_rows for each row execute function public.reading_rows_log();

-- The two new pages in «الصلاحيات».
create or replace function public.admin_set_pages(p_id uuid, p_pages text[]) returns void
language plpgsql security definer set search_path = public as $$
declare v text[];
begin
  if not public.is_manager() then raise exception 'not_allowed' using errcode = '42501'; end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v
    from unnest(coalesce(p_pages, '{}')) as x
   where x in ('generation', 'distribution', 'tasks', 'attendance', 'stock', 'seal-work', 'readings', 'readings-admin');
  update public.employees set pages = v where id = p_id;
  if not found then raise exception 'missing'; end if;
end $$;
revoke execute on function public.is_reading_admin(), public.admin_set_pages(uuid, text[]) from anon, public;
grant execute on function public.is_reading_admin(), public.admin_set_pages(uuid, text[]) to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'reading_rows') then
    alter publication supabase_realtime add table public.reading_rows;
  end if;
end $$;

notify pgrst, 'reload schema';
