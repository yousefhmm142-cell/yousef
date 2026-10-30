-- Mukhayyam 2 operations system: tables.
-- Target: Supabase (PostgreSQL 15+). All times are timestamptz; the business day is Asia/Gaza.
-- Figures in the generation report and distribution sheet are typed by site staff, never computed here.
-- Typed figures are plain numeric with only a "not negative" rule: an odd value is flagged by the
-- app's alerts, never refused, so a phone can always send what was written on site.

-- ---------- Types ----------
create type public.user_role as enum ('admin', 'manager', 'generation_operator', 'distribution_supervisor', 'technician', 'staff');
create type public.sheet_status as enum ('draft', 'submitted', 'returned', 'approved');
create type public.load_unit as enum ('A', 'kW');
create type public.pressure_unit as enum ('bar', 'psi');
create type public.task_status as enum ('new', 'sent', 'seen', 'in_progress', 'done', 'cancelled');
create type public.task_priority as enum ('normal', 'urgent', 'emergency');
create type public.message_channel as enum ('sms', 'whatsapp');
-- 'opened': the manager's phone opened SMS/WhatsApp with the text ready (free mode).
-- 'pending' / 'sent' / 'failed': reserved for an SMS gateway later.
create type public.message_status as enum ('opened', 'pending', 'sent', 'failed');
create type public.punch_kind as enum ('in', 'out');
create type public.punch_method as enum ('qr', 'manual');
create type public.leave_type as enum ('annual', 'sick', 'emergency', 'other');

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- People and settings ----------
create table public.work_schedules (
  id smallint generated always as identity primary key,
  name text not null unique,
  start_time time not null,
  end_time time not null,
  grace_minutes smallint not null default 10 check (grace_minutes between 0 and 120),
  absent_after time not null default '10:00',
  overtime_min_minutes smallint not null default 15 check (overtime_min_minutes >= 0),
  overtime_round_minutes smallint not null default 15 check (overtime_round_minutes > 0),
  -- PostgreSQL day of week: 0 = Sunday ... 6 = Saturday. Default: Saturday to Thursday.
  work_days smallint[] not null default '{6,0,1,2,3,4}',
  check (end_time > start_time)
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  full_name text not null check (length(btrim(full_name)) between 2 and 80),
  -- Palestinian mobile, 10 digits (059 Jawwal, 056 Ooredoo). Null until the admin adds it.
  phone text unique check (phone ~ '^05[0-9]{8}$'),
  role public.user_role not null,
  schedule_id smallint references public.work_schedules (id),
  tracks_attendance boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger employees_touch before update on public.employees
  for each row execute function public.touch_updated_at();

-- Single row of alert thresholds and site constants.
create table public.app_settings (
  id boolean primary key default true check (id),
  fuel_days_warn numeric(4, 1) not null default 2,
  fuel_days_danger numeric(4, 1) not null default 1,
  consumption_warn_pct smallint not null default 20,
  consumption_danger_pct smallint not null default 40,
  temp_warn_c numeric(5, 1) not null default 95,
  temp_danger_c numeric(5, 1) not null default 100,
  oil_warn_bar numeric(4, 2) not null default 2.0,
  oil_danger_bar numeric(4, 2) not null default 1.5,
  load_warn_pct smallint not null default 80,
  load_danger_pct smallint not null default 90,
  imbalance_warn_pct smallint not null default 20,
  imbalance_danger_pct smallint not null default 35,
  oil_change_warn_hours smallint not null default 230,
  oil_change_due_hours smallint not null default 250,
  report_late_warn time not null default '10:00',
  report_late_danger time not null default '12:00',
  phase_voltage smallint not null default 230,
  updated_at timestamptz not null default now()
);
create trigger app_settings_touch before update on public.app_settings
  for each row execute function public.touch_updated_at();

create table public.holidays (
  holiday_date date primary key,
  name text not null
);

-- ---------- Module 1: generation site ----------
create table public.generators (
  id smallint generated always as identity primary key,
  name text not null unique,
  brand text not null,
  model text,
  capacity_kva numeric check (capacity_kva > 0),
  is_active boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);

create table public.fuel_types (
  id smallint generated always as identity primary key,
  name text not null unique,
  is_active boolean not null default true,
  sort_order smallint not null default 0
);

create table public.site_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null unique,
  status public.sheet_status not null default 'draft',
  general_notes text,
  created_by uuid references public.employees (id),
  submitted_by uuid references public.employees (id),
  submitted_at timestamptz,
  approved_by uuid references public.employees (id),
  approved_at timestamptz,
  returned_reason text,
  device_time timestamptz,
  recorded_offline boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger site_reports_touch before update on public.site_reports
  for each row execute function public.touch_updated_at();
-- Devices ask for "what changed since my last look".
create index site_reports_updated on public.site_reports (updated_at);

create table public.site_report_fuel (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.site_reports (id) on delete cascade,
  fuel_type_id smallint not null references public.fuel_types (id),
  opening_balance numeric check (opening_balance >= 0),
  received_qty numeric check (received_qty >= 0),
  total_qty numeric check (total_qty >= 0),
  closing_balance numeric check (closing_balance >= 0),
  consumption numeric check (consumption >= 0),
  shipment_no text,
  notes text,
  updated_at timestamptz not null default now(),
  unique (report_id, fuel_type_id)
);
create trigger site_report_fuel_touch before update on public.site_report_fuel
  for each row execute function public.touch_updated_at();

create table public.generator_day_logs (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.site_reports (id) on delete cascade,
  generator_id smallint not null references public.generators (id),
  -- false: the operator marked "did not run today".
  did_run boolean not null default true,
  run_hours numeric check (run_hours >= 0),
  load_unit public.load_unit not null default 'A',
  load_l1 numeric check (load_l1 >= 0),
  load_l2 numeric check (load_l2 >= 0),
  load_l3 numeric check (load_l3 >= 0),
  temperature_c numeric,
  oil_pressure numeric check (oil_pressure >= 0),
  oil_pressure_unit public.pressure_unit not null default 'bar',
  notes text,
  updated_at timestamptz not null default now(),
  unique (report_id, generator_id)
);
create trigger generator_day_logs_touch before update on public.generator_day_logs
  for each row execute function public.touch_updated_at();

-- end_time earlier than start_time means the run crossed midnight (e.g. 20:00 -> 01:00).
-- Times may be empty while the report is still a draft.
create table public.generator_runs (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references public.generator_day_logs (id) on delete cascade,
  run_no smallint not null check (run_no between 1 and 6),
  start_time time,
  end_time time,
  updated_at timestamptz not null default now(),
  unique (log_id, run_no)
);
create trigger generator_runs_touch before update on public.generator_runs
  for each row execute function public.touch_updated_at();

create table public.maintenance_logs (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.site_reports (id) on delete cascade,
  -- Empty while the operator has not picked the generator yet.
  generator_id smallint references public.generators (id),
  oil_new_liters numeric check (oil_new_liters >= 0),
  oil_used_liters numeric check (oil_used_liters >= 0),
  maintenance_types text[] not null default '{}'
    check (maintenance_types <@ array['oil_change', 'oil_filter', 'fuel_filter', 'air_filter', 'cooling', 'battery', 'belt', 'electrical', 'other']),
  description text,
  updated_at timestamptz not null default now()
);
create trigger maintenance_logs_touch before update on public.maintenance_logs
  for each row execute function public.touch_updated_at();

-- ---------- Module 2: distribution and loads ----------
create table public.zones (
  id smallint generated always as identity primary key,
  name text not null unique,
  is_active boolean not null default true,
  sort_order smallint not null default 0
);

create table public.distribution_sheets (
  id uuid primary key default gen_random_uuid(),
  sheet_date date not null unique,
  status public.sheet_status not null default 'draft',
  notes text,
  created_by uuid references public.employees (id),
  submitted_by uuid references public.employees (id),
  submitted_at timestamptz,
  approved_by uuid references public.employees (id),
  approved_at timestamptz,
  returned_reason text,
  device_time timestamptz,
  recorded_offline boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger distribution_sheets_touch before update on public.distribution_sheets
  for each row execute function public.touch_updated_at();
create index distribution_sheets_updated on public.distribution_sheets (updated_at);

create table public.zone_day_entries (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.distribution_sheets (id) on delete cascade,
  zone_id smallint not null references public.zones (id),
  -- false: the supervisor marked "not supplied today".
  supplied boolean not null default true,
  supply_hours numeric check (supply_hours >= 0),
  updated_at timestamptz not null default now(),
  unique (sheet_id, zone_id)
);
create trigger zone_day_entries_touch before update on public.zone_day_entries
  for each row execute function public.touch_updated_at();

create table public.zone_runs (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.zone_day_entries (id) on delete cascade,
  run_no smallint not null check (run_no between 1 and 6),
  start_time time,
  end_time time,
  load_unit public.load_unit not null default 'A',
  load_l1 numeric check (load_l1 >= 0),
  load_l2 numeric check (load_l2 >= 0),
  load_l3 numeric check (load_l3 >= 0),
  updated_at timestamptz not null default now(),
  unique (entry_id, run_no)
);
create trigger zone_runs_touch before update on public.zone_runs
  for each row execute function public.touch_updated_at();

-- ---------- Module 3: field tasks ----------
create table public.task_types (
  id smallint generated always as identity primary key,
  name text not null unique,
  is_active boolean not null default true,
  sort_order smallint not null default 0
);

create sequence public.task_number_seq;

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  number integer not null unique default nextval('public.task_number_seq'),
  task_type_id smallint not null references public.task_types (id),
  assignee_id uuid not null references public.employees (id),
  created_by uuid references public.employees (id),
  details text,
  subscriber_name text,
  subscriber_phone text check (subscriber_phone ~ '^05[0-9]{8}$'),
  zone_id smallint references public.zones (id),
  location_text text,
  priority public.task_priority not null default 'normal',
  expected_minutes smallint not null check (expected_minutes between 5 and 1440),
  status public.task_status not null default 'new',
  sent_at timestamptz,
  seen_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  actual_minutes integer generated always as (
    case when started_at is not null and completed_at is not null
      then floor(extract(epoch from (completed_at - started_at)) / 60)::integer end
  ) stored,
  completion_notes text,
  cancel_reason text,
  photo_path text,
  -- Set by the app when an action was taken without internet; the server then trusts device_time (flagged).
  device_time timestamptz,
  recorded_offline boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (completed_at is null or (started_at is not null and completed_at >= started_at))
);
alter sequence public.task_number_seq owned by public.tasks.number;
create index tasks_assignee_status on public.tasks (assignee_id, status);
create index tasks_open on public.tasks (status) where status not in ('done', 'cancelled');
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();

create table public.task_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks (id) on delete cascade,
  event text not null check (event in ('created', 'sent_sms', 'sent_whatsapp', 'seen', 'started', 'completed', 'cancelled', 'reassigned')),
  actor_id uuid references public.employees (id),
  at timestamptz not null default now(),
  recorded_offline boolean not null default false,
  meta jsonb
);
create index task_events_task on public.task_events (task_id, at);

create table public.outgoing_messages (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks (id) on delete set null,
  channel public.message_channel not null,
  to_phone text not null check (to_phone ~ '^05[0-9]{8}$'),
  body text not null,
  status public.message_status not null default 'opened',
  provider text,
  provider_ref text,
  error text,
  created_by uuid references public.employees (id),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

-- ---------- Module 4: attendance ----------
-- One printed QR sheet per point. Printing a new sheet revokes the old code.
create table public.attendance_points (
  id smallint generated always as identity primary key,
  name text not null,
  code text not null unique default replace(gen_random_uuid()::text, '-', ''),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table public.attendance_punches (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id),
  kind public.punch_kind not null,
  at timestamptz not null default now(),
  method public.punch_method not null,
  point_id smallint references public.attendance_points (id),
  recorded_by uuid references public.employees (id),
  reason text,
  device_time timestamptz,
  recorded_offline boolean not null default false,
  created_at timestamptz not null default now(),
  check (method <> 'qr' or point_id is not null),
  check (method <> 'manual' or (recorded_by is not null and length(btrim(coalesce(reason, ''))) > 0))
);
create index attendance_punches_employee_at on public.attendance_punches (employee_id, at);

create table public.leaves (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id),
  from_date date not null,
  to_date date not null,
  type public.leave_type not null,
  notes text,
  approved_by uuid references public.employees (id),
  created_at timestamptz not null default now(),
  check (to_date >= from_date)
);

-- ---------- Change history ----------
create table public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id text not null,
  action text not null check (action in ('update', 'delete')),
  actor_id uuid references public.employees (id),
  at timestamptz not null default now(),
  old_row jsonb,
  new_row jsonb
);
create index audit_log_record on public.audit_log (table_name, record_id, at);
