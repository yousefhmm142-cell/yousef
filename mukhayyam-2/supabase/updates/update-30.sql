-- =====================================================================
--  نظام مخيم 2: التحديث 30 · أسبوع القراءات فيه ملفات كثيرة
--  يُطبَّق تلقائياً مع الرفع (أو الصقه في Supabase > SQL Editor ثم Run). تكراره لا يضر.
-- =====================================================================
-- Each file the office uploads is kept as it came; every subscriber row knows its file and sheet,
-- so the export gives back every file with its own «القراءة الحالية» filled.

create table if not exists public.reading_files (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.reading_batches (id) on delete cascade,
  file_name text not null,
  source_b64 text not null,
  current_col integer not null default 4,
  rows_count integer not null default 0,
  created_by uuid references public.employees (id),
  created_at timestamptz not null default now()
);
create index if not exists reading_files_batch on public.reading_files (batch_id, created_at);
alter table public.reading_rows add column if not exists file_id uuid references public.reading_files (id) on delete cascade;
alter table public.reading_rows add column if not exists sheet text;

alter table public.reading_files enable row level security;
drop policy if exists reading_files_admin on public.reading_files;
create policy reading_files_admin on public.reading_files for all to authenticated
  using (public.is_reading_admin()) with check (public.is_reading_admin());
revoke all on public.reading_files from anon;
grant select, insert, update, delete on public.reading_files to authenticated;

-- The reader still changes only the reading, the state and the note (now also never the file or sheet).
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
    if (new.batch_id, new.ord, new.sheet_row, new.code, new.area, new.board, new.fak, new.subscriber, new.phone, new.prev, new.mode, new.assignee_id, new.file_id, new.sheet)
       is distinct from (old.batch_id, old.ord, old.sheet_row, old.code, old.area, old.board, old.fak, old.subscriber, old.phone, old.prev, old.mode, old.assignee_id, old.file_id, old.sheet) then
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
