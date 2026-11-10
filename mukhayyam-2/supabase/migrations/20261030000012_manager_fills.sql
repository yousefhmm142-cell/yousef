-- =====================================================================
--  نظام مخيم 2: المدير يعبّي كشف التوليد وكشف التوزيع بنفسه
-- =====================================================================
-- Managers (like the system admin) may fill a day's report or sheet and close it, on top of
-- approving and reopening. Site staff are unchanged.

create or replace function public.sheet_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.user_role := public.current_user_role();
  me uuid := public.current_employee_id();
  site boolean := r in ('generation_operator', 'distribution_supervisor');
begin
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'submitted') then
      raise exception 'A new sheet starts as draft or submitted';
    end if;
    new.created_by := coalesce(me, new.created_by);
    new.submitted_by := null; new.submitted_at := null;
    new.approved_by := null; new.approved_at := null;
    if new.status = 'submitted' then
      new.submitted_by := me;
      new.submitted_at := public.event_time(new.recorded_offline, new.device_time, null);
    end if;
    return new;
  end if;

  if site and old.status in ('submitted', 'approved') then
    raise exception 'This sheet was sent and can no longer be edited by site staff';
  end if;

  if new.status is distinct from old.status then
    if site and not (old.status in ('draft', 'returned') and new.status = 'submitted') then
      raise exception 'Site staff can only send a draft or returned sheet';
    end if;
    if r = 'manager' and not (
         (old.status = 'submitted' and new.status in ('approved', 'returned'))
      or (old.status = 'approved' and new.status = 'returned')
      or (old.status in ('draft', 'returned') and new.status = 'submitted')) then
      raise exception 'The manager can fill and close a day, approve a closed day or reopen it';
    end if;
    if not site and r is distinct from 'manager' and r is distinct from 'admin' then
      raise exception 'Not allowed';
    end if;
    if new.status = 'submitted' then
      new.submitted_by := me;
      new.submitted_at := public.event_time(new.recorded_offline, new.device_time, null);
      new.returned_reason := null;
    elsif new.status = 'approved' then
      new.approved_by := me;
      new.approved_at := now();
    elsif new.status = 'returned' then
      if length(btrim(coalesce(new.returned_reason, ''))) = 0 then
        raise exception 'Reopening a day needs a reason';
      end if;
      new.approved_by := null; new.approved_at := null;
    end if;
  else
    new.submitted_by := old.submitted_by; new.submitted_at := old.submitted_at;
    new.approved_by := old.approved_by; new.approved_at := old.approved_at;
  end if;
  new.created_by := old.created_by;
  return new;
end $$;

notify pgrst, 'reload schema';
