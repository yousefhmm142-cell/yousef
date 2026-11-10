-- =====================================================================
--  نظام مخيم 2: الأختام - قراءة رقم الطبلون واسمه من تفاصيل الاستخدام بشكل أدق
-- =====================================================================
-- «طبلون أبو هويشل 10 فصل» كان يُحفظ «أبو»، و«طبلون شمال المقبرة (19)» كان يُحفظ «شمال».
-- الآن يُحفظ الاسم كاملاً مع الرقم (أبو هويشل 10 · شمال المقبرة 19 · 361)، وتُعاد قراءة المحفوظ.

create or replace function public.seal_board_no_raw(p_details text) returns text
language plpgsql immutable as $$
declare
  t text := regexp_replace(coalesce(p_details, ''), '[()]', ' ', 'g');
  kw text := '(?:فصل|[اإ]عاد|تركيب|تنزيل|رفع|تغيير|تغيير|فك|تفتيش|صيانه|صيانة|[اإ]ضاف|نقل|تغذي|شبك|ختم|تبديل|ترجيع|قص|فتح|توصيل|تعديل|تمديد|وصل|اشتراك|بدل|[اإ]ستبدال|تحويل|ساعه|ساعة|كشف)';
  m text[];
begin
  -- «طبلون 361 ...» or «طبلون 8 a الأبراج»: the number first, then at most one more word of the name.
  m := regexp_match(t, 'طبلون(?:ات)?\s*(?:رقم\s*)?([0-9]+\s?[A-Za-z]?)(?![A-Za-z0-9])(?:\s+(?!' || kw || ')([^\s0-9]{2,}(?:\s+(?!' || kw || ')[^\s0-9]{2,})?))?');
  if m is not null and m[1] is not null then
    return nullif(btrim(m[1] || coalesce(' ' || m[2], '')), '');
  end if;
  -- «طبلون أبو هويشل 10 ...»: up to three words, then the number (and a letter stuck to it).
  m := regexp_match(t, 'طبلون(?:ات)?\s+((?:(?!' || kw || ')[^\s0-9]{2,}\s+){1,3}[0-9]+\s?[A-Za-z]?)(?![A-Za-z0-9])');
  if m is not null then return btrim(m[1]); end if;
  -- No number: the first two words that are not a kind of work.
  m := regexp_match(t, 'طبلون(?:ات)?\s+((?!' || kw || ')[^\s0-9]{2,}(?:\s+(?!' || kw || ')[^\s0-9]{2,})?)');
  return nullif(btrim(coalesce(m[1], '')), '');
end $$;

-- The same, with the spaces between words made single.
create or replace function public.seal_board_no(p_details text) returns text
language sql immutable as $$
  select nullif(regexp_replace(btrim(coalesce(public.seal_board_no_raw(p_details), '')), '\s+', ' ', 'g'), '')
$$;

-- The width her numbers column had on its sheet, so the export looks the same.
alter table public.seal_rolls add column if not exists sheet_width numeric;
alter table public.seal_rolls add column if not exists sheet_tab text;
alter table public.seal_batches add column if not exists usage_fill text;

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

  insert into public.seal_rolls (from_no, to_no, received_on, note, created_by, header_text, sheet_label, sheet_pos, sheet_col, sheet_width, sheet_tab)
    values (v_from, v_to, (p ->> 'received_on')::date, nullif(p ->> 'note', ''), v_me,
            nullif(p ->> 'header_text', ''), nullif(p ->> 'sheet_label', ''), nullif(p ->> 'sheet_pos', '')::smallint, nullif(p ->> 'sheet_col', '')::smallint, nullif(p ->> 'sheet_width', '')::numeric, nullif(p ->> 'sheet_tab', ''))
    returning id into v_roll;
  insert into public.seals (seal_no, roll_id, updated_by) select g, v_roll, v_me from generate_series(v_from, v_to) g;

  for b in select * from jsonb_array_elements(coalesce(p -> 'batches', '[]'::jsonb)) loop
    v_no := v_no + 1;
    insert into public.seal_batches (roll_id, batch_no, technician_id, issued_on, created_by, original_seals, block_from, block_ord, label, usage_ord, usage_fill)
      values (v_roll, v_no, (b ->> 'tech')::uuid, (b ->> 'date')::date, v_me,
              (select array_agg(x::integer order by o) from jsonb_array_elements_text(b -> 'seals') with ordinality as t (x, o)),
              nullif(b ->> 'block_from', '')::integer, nullif(b ->> 'ord', '')::smallint, nullif(btrim(b ->> 'label'), ''), nullif(b ->> 'usage_ord', '')::integer, nullif(b ->> 'fill', ''))
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

grant execute on function public.seal_import_roll(jsonb) to authenticated;
revoke execute on function public.seal_import_roll(jsonb) from anon, public;

-- Read again what is already saved (the change history is not touched: only the derived field).
alter table public.seals disable trigger seals_audit;
update public.seals set board_no = public.seal_board_no(details) where details is not null and board_no is distinct from public.seal_board_no(details);
alter table public.seals enable trigger seals_audit;

revoke execute on function public.seal_board_no_raw(text), public.seal_board_no(text) from anon, public;
grant execute on function public.seal_board_no_raw(text), public.seal_board_no(text) to authenticated;
notify pgrst, 'reload schema';
