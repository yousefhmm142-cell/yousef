-- =====================================================================
--  نظام مخيم 2: التحديث 29 · القارئ يشوف كشف القراءات تبعه
--  يُطبَّق تلقائياً مع الرفع (أو الصقه في Supabase > SQL Editor ثم Run). تكراره لا يضر.
-- =====================================================================
-- The reader's rule compared the row with itself (an unqualified «id» inside the subquery):
-- now it names the batch, so a reader sees the week he has subscribers in.

drop policy if exists reading_batches_read on public.reading_batches;
create policy reading_batches_read on public.reading_batches for select to authenticated
  using (public.is_reading_admin() or exists (
    select 1 from public.reading_rows r where r.batch_id = reading_batches.id and r.assignee_id = public.current_employee_id()
  ));
