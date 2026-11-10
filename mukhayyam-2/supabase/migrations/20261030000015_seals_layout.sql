-- =====================================================================
--  نظام مخيم 2: الأختام · حفظ شكل ملفاتها القديمة ليخرج التصدير مطابقاً لها
-- =====================================================================
-- So the Excel export reads exactly like her two old files:
--  - seal_rolls.header_text / sheet_label / sheet_pos: the heading of each roll as she wrote it, and
--    which sheet it sits on (several rolls may share one sheet, one under the other);
--  - seal_batches.original_seals: the numbers of a batch as written, so a batch whose seals were
--    later handed on to someone else still shows its own line;
--  - employees.seals_sheet: the name of a technician's sheet in the usage file.
-- Needs update 10 and update 11. Can be run again.

alter table public.seal_rolls add column if not exists header_text text check (header_text is null or length(header_text) <= 300);
alter table public.seal_rolls add column if not exists sheet_label text check (sheet_label is null or length(sheet_label) <= 60);
alter table public.seal_rolls add column if not exists sheet_pos smallint;
alter table public.seal_rolls add column if not exists sheet_col smallint;
alter table public.seal_batches add column if not exists original_seals integer[];
-- Where the line sat in her file: under which roll's heading, in what order, and the word she wrote.
alter table public.seal_batches add column if not exists block_from integer;
alter table public.seal_batches add column if not exists block_ord smallint;
alter table public.seal_batches add column if not exists label text;
alter table public.seal_batches add column if not exists usage_ord integer;
alter table public.employees add column if not exists seals_sheet text check (seals_sheet is null or length(seals_sheet) <= 60);

-- Taking seals back must not remove a batch that keeps its own written line.
create or replace function public.seal_return_to_stock(p_seals integer[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_employee_id();
  v_done integer;
begin
  if not public.has_seals() then raise exception 'not_allowed' using errcode = '42501'; end if;
  -- A batch someone changes no longer follows the line as it was first written.
  update public.seal_batches set original_seals = null where id in (select batch_id from public.seals where seal_no = any (p_seals));
  update public.seals
     set status = 'in_stock', batch_id = null, batch_pos = null, technician_id = null, issued_on = null,
         used_on = null, details = null, board_no = null, updated_by = v_me
   where seal_no = any (p_seals) and status <> 'in_stock';
  get diagnostics v_done = row_count;
  delete from public.seal_batches b where b.original_seals is null and not exists (select 1 from public.seals s where s.batch_id = b.id);
  return v_done;
end $$;

create or replace function public.seal_unissue(p_seals integer[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_employee_id();
  v_done integer;
begin
  if not public.has_seals() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if exists (select 1 from public.seals where seal_no = any (p_seals) and status not in ('issued', 'in_stock')) then
    raise exception 'already_used';
  end if;
  update public.seal_batches set original_seals = null where id in (select batch_id from public.seals where seal_no = any (p_seals));
  update public.seals
     set status = 'in_stock', batch_id = null, batch_pos = null, technician_id = null, issued_on = null,
         used_on = null, details = null, board_no = null, updated_by = v_me
   where seal_no = any (p_seals) and status = 'issued';
  get diagnostics v_done = row_count;
  delete from public.seal_batches b where b.original_seals is null and not exists (select 1 from public.seals s where s.batch_id = b.id);
  return v_done;
end $$;

-- A batch with no seals left and no written line goes with its last seal; one with a line is removed here.
create or replace function public.seal_delete_batch(p_batch uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare v_seals integer[];
begin
  if not public.has_seals() then raise exception 'not_allowed' using errcode = '42501'; end if;
  select array_agg(seal_no) into v_seals from public.seals where batch_id = p_batch;
  if v_seals is not null then perform public.seal_return_to_stock(v_seals); end if;
  delete from public.seal_batches where id = p_batch;
  return coalesce(array_length(v_seals, 1), 0);
end $$;

-- The technician, found by name; the usage file's sheet name is kept for the export.
drop function if exists public.seal_import_technician(text);
create or replace function public.seal_import_technician(p_name text, p_sheet text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_key text := public.seal_name_key(v_name);
  v_words text[] := regexp_split_to_array(v_name, '\s+');
  v_id uuid;
  v_n integer;
begin
  if not public.is_manager() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if length(v_name) < 2 then raise exception 'bad_name'; end if;
  select id into v_id from public.employees
   where public.seal_name_key(full_name) = v_key order by is_active desc, created_at limit 1;
  if v_id is null and array_length(v_words, 1) >= 2 then
    select count(*), min(id::text)::uuid into v_n, v_id from public.employees e
     where e.role = 'technician'
       and public.seal_name_key((regexp_split_to_array(btrim(e.full_name), '\s+'))[1]) = public.seal_name_key(v_words[1])
       and public.seal_name_key((regexp_split_to_array(btrim(e.full_name), '\s+'))[array_length(regexp_split_to_array(btrim(e.full_name), '\s+'), 1)]) = public.seal_name_key(v_words[array_length(v_words, 1)]);
    if v_n <> 1 then v_id := null; end if;
  end if;
  if v_id is null then
    select count(*), min(id::text)::uuid into v_n, v_id from public.employees e
     where e.role = 'technician'
       and ((array_length(v_words, 1) = 1 and length(v_key) <= 6 and public.seal_name_key(e.full_name) like v_key || '%')
         or (array_length(v_words, 1) = 1 and length(v_key) > 6
             and public.seal_name_key(e.full_name) like left(v_key, 4) || '%' and public.seal_name_key(e.full_name) like '%' || right(v_key, 5)));
    if v_n <> 1 then v_id := null; end if;
  end if;
  if v_id is null then
    insert into public.employees (full_name, role, is_active, tracks_attendance) values (v_name, 'technician', false, false) returning id into v_id;
  end if;
  if nullif(btrim(coalesce(p_sheet, '')), '') is not null then
    update public.employees set seals_sheet = btrim(p_sheet) where id = v_id and seals_sheet is null;
  end if;
  return v_id;
end $$;

-- One roll with everything known about it. A later batch may take over seals an earlier one listed
-- (handed back and given to someone else); the earlier batch keeps its written line.
create or replace function public.seal_import_roll(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_employee_id();
  v_from integer := (p ->> 'from')::integer;
  v_to integer := (p ->> 'to')::integer;
  v_roll uuid;
  b jsonb;
  v_batch uuid;
  v_no integer := 0;
  v_issued integer := 0;
  v_outside integer := 0;
  v_cnt integer;
begin
  if not public.is_manager() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if exists (select 1 from public.seal_rolls where from_no = v_from and to_no = v_to) then
    return jsonb_build_object('skipped', true);
  end if;
  if v_from is null or v_to < v_from or v_to - v_from >= 1000 then raise exception 'bad_range'; end if;
  if exists (select 1 from public.seal_rolls where from_no <= v_to and to_no >= v_from) then raise exception 'roll_overlap'; end if;

  insert into public.seal_rolls (from_no, to_no, received_on, note, created_by, header_text, sheet_label, sheet_pos, sheet_col)
    values (v_from, v_to, (p ->> 'received_on')::date, nullif(p ->> 'note', ''), v_me,
            nullif(p ->> 'header_text', ''), nullif(p ->> 'sheet_label', ''), nullif(p ->> 'sheet_pos', '')::smallint, nullif(p ->> 'sheet_col', '')::smallint)
    returning id into v_roll;
  insert into public.seals (seal_no, roll_id, updated_by) select g, v_roll, v_me from generate_series(v_from, v_to) g;

  for b in select * from jsonb_array_elements(coalesce(p -> 'batches', '[]'::jsonb)) loop
    v_no := v_no + 1;
    insert into public.seal_batches (roll_id, batch_no, technician_id, issued_on, created_by, original_seals, block_from, block_ord, label, usage_ord)
      values (v_roll, v_no, (b ->> 'tech')::uuid, (b ->> 'date')::date, v_me,
              (select array_agg(x::integer order by o) from jsonb_array_elements_text(b -> 'seals') with ordinality as t (x, o)),
              nullif(b ->> 'block_from', '')::integer, nullif(b ->> 'ord', '')::smallint, nullif(btrim(b ->> 'label'), ''), nullif(b ->> 'usage_ord', '')::integer)
      returning id into v_batch;
    update public.seals s
       set status = 'issued', batch_id = v_batch, batch_pos = o.pos, technician_id = (b ->> 'tech')::uuid,
           issued_on = (b ->> 'date')::date, used_on = null, details = null, board_no = null, updated_by = v_me
      from jsonb_array_elements_text(b -> 'seals') with ordinality as o (no, pos)
     where s.seal_no = o.no::integer and s.status in ('in_stock', 'issued');
    get diagnostics v_cnt = row_count;
    v_issued := v_issued + v_cnt;
    v_outside := v_outside + (jsonb_array_length(b -> 'seals') - v_cnt);
  end loop;

  update public.seals set status = 'damaged', updated_by = v_me
   where roll_id = v_roll and status = 'in_stock' and seal_no in (select x::integer from jsonb_array_elements_text(coalesce(p -> 'damaged', '[]'::jsonb)) x);

  return jsonb_build_object('roll_id', v_roll, 'batches', v_no, 'issued', v_issued, 'outside', v_outside);
end $$;

-- What happened to each seal (from the usage file), applied once every roll and batch is in.
create or replace function public.seal_import_usage(p jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_employee_id();
  v_done integer;
begin
  if not public.is_manager() then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.seals s
     set status = u.status, used_on = nullif(u.used_on, '')::date, details = nullif(btrim(u.details), ''),
         board_no = public.seal_board_no(u.details), updated_by = v_me
    from jsonb_to_recordset(coalesce(p, '[]'::jsonb)) as u (no integer, status text, used_on text, details text)
   where s.seal_no = u.no and u.status in ('used', 'damaged', 'lost')
     and (s.status = 'issued' or (u.status = 'damaged' and s.status in ('in_stock', 'damaged')));
  get diagnostics v_done = row_count;
  return v_done;
end $$;

revoke execute on function public.seal_import_technician(text, text), public.seal_import_roll(jsonb), public.seal_import_usage(jsonb), public.seal_delete_batch(uuid), public.seal_return_to_stock(integer[]), public.seal_unissue(integer[]) from anon, public;
grant execute on function public.seal_import_technician(text, text), public.seal_import_roll(jsonb), public.seal_import_usage(jsonb), public.seal_delete_batch(uuid), public.seal_return_to_stock(integer[]), public.seal_unissue(integer[]) to authenticated;

notify pgrst, 'reload schema';
