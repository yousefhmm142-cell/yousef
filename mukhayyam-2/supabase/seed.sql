-- Mukhayyam 2: starting data taken from the paper forms.
-- People are added without phone numbers; the admin adds each phone and creates the login later.

insert into public.work_schedules (name, start_time, end_time) values
  ('دوام كامل', '08:00', '17:00'),
  ('بطالة', '08:00', '14:00');

insert into public.app_settings default values;

insert into public.fuel_types (name, sort_order) values
  ('سولار صناعي', 1),
  ('سولار إسرائيلي', 2);

insert into public.zones (name, sort_order) values
  ('المخيم القديم', 1),
  ('المخيم الجديد', 2),
  ('الرازي', 3),
  ('الأبراج', 4),
  ('شوافع القديم', 5),
  ('شوافع الجديد', 6);

insert into public.task_types (name, sort_order) values
  ('شد وتوصيل كوابل', 1),
  ('تفتيش', 2),
  ('تركيب اشتراك', 3),
  ('تبديل ساعة', 4),
  ('رفع وتنزيل قدرة', 5),
  ('فحص ساعة', 6),
  ('تعديل أحمال', 7),
  ('نقل اشتراك', 8),
  ('فصل ووصل', 9),
  ('صيانات عامة', 10);

insert into public.attendance_points (name) values ('المكتب');

insert into public.employees (full_name, role, schedule_id)
select v.full_name, v.role::public.user_role, s.id
from (values
  ('رامي أبو عجوة', 'manager'),
  ('قصي الشافعي', 'technician'),
  ('مجد عاشور', 'technician'),
  ('بشار الشافعي', 'technician'),
  ('أحمد طعيمة', 'technician'),
  ('بشار خطاب', 'technician')
) as v (full_name, role)
cross join public.work_schedules s
where s.name = 'دوام كامل';
