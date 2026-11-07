-- نظام إدارة قسم المونتاج
-- نفّذ هذا الملف كاملاً في Supabase SQL Editor بعد إنشاء مشروعك.

create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.employees (
  id text primary key,
  name text not null,
  office text not null default '',
  role text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.roster_entries (
  id bigint generated always as identity primary key,
  month text not null,
  employee_id text not null references public.employees(id) on delete cascade,
  day integer not null check (day between 1 and 31),
  shift text not null check (shift in ('ص','م','off')),
  updated_at timestamptz not null default now(),
  unique(month, employee_id, day)
);

create table if not exists public.settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null references public.employees(id),
  video_name text not null,
  program_name text not null,
  created_at timestamptz not null default now(),
  approved boolean not null default false
);

insert into public.employees (id,name,office,role) values
('emp_1','عمرو المحرمي','مكتب عدن','مونتاج النشرة الرئيسي + تقارير التاسعة'),
('emp_2','أرسلان حبيب','مكتب عدن','المجهر الجنوبي + تقارير التاسعة'),
('emp_3','جلال عمر','مكتب عدن','مونتاج تقارير الأخبار + رقابة وتشييك'),
('emp_4','يزن الجابري','مكتب لحج','النشرة الرئيسي + صوت المواطن + أبعاد سياسية'),
('emp_5','خالد بن نشوان','مكتب لحج','النشرة الرئيسي + المشهد الجنوبي + صباحك يا عدن'),
('emp_6','أبوبكر بن شهاب','مكتب لحج','ستار كاست + المشهد الجنوبي + صباحك يا عدن'),
('emp_7','علي أحمد','مكتب لحج','المجهر الجنوبي + تقارير التاسعة')
on conflict (id) do update set name=excluded.name, office=excluded.office, role=excluded.role;

insert into public.settings(key,value) values
('fixed_notice', to_jsonb('يرجى تسليم المواد الجاهزة لقسم الرقابة: نور الدين السقاف (مكتب لحج) — جلال عمر (مكتب عدن)'::text))
on conflict (key) do nothing;

alter table public.admin_users enable row level security;
alter table public.employees enable row level security;
alter table public.roster_entries enable row level security;
alter table public.settings enable row level security;
alter table public.tasks enable row level security;

-- يسمح للمستخدم بالتحقق من عضويته هو فقط، دون كشف قائمة المديرين
drop policy if exists "admin can read own membership" on public.admin_users;
create policy "admin can read own membership" on public.admin_users
for select using (user_id = auth.uid());

-- الدالة تتحقق من أن المستخدم مسجل ضمن مديري النظام
create or replace function public.is_montage_admin()
returns boolean language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

-- قراءة عامة لصفحة الموظفين
drop policy if exists "public read employees" on public.employees;
create policy "public read employees" on public.employees for select using (active = true or public.is_montage_admin());

drop policy if exists "public read roster" on public.roster_entries;
create policy "public read roster" on public.roster_entries for select using (true);

drop policy if exists "public read settings" on public.settings;
create policy "public read settings" on public.settings for select using (true);

drop policy if exists "public read tasks" on public.tasks;
create policy "public read tasks" on public.tasks for select using (true);

-- المدير وحده يستطيع إدارة الموظفين والدوام والإعدادات والاعتماد
drop policy if exists "admin manage employees" on public.employees;
create policy "admin manage employees" on public.employees for all using (public.is_montage_admin()) with check (public.is_montage_admin());

drop policy if exists "admin manage roster" on public.roster_entries;
create policy "admin manage roster" on public.roster_entries for all using (public.is_montage_admin()) with check (public.is_montage_admin());

drop policy if exists "admin manage settings" on public.settings;
create policy "admin manage settings" on public.settings for all using (public.is_montage_admin()) with check (public.is_montage_admin());

drop policy if exists "admin update tasks" on public.tasks;
create policy "admin update tasks" on public.tasks for update using (public.is_montage_admin()) with check (public.is_montage_admin());

drop policy if exists "admin delete tasks" on public.tasks;
create policy "admin delete tasks" on public.tasks for delete using (public.is_montage_admin());

-- الموظف يستطيع إرسال إشعار إنجاز فقط، ولا يستطيع تعديل أو حذف السجلات
drop policy if exists "public submit completed video" on public.tasks;
create policy "public submit completed video" on public.tasks for insert with check (
  exists (select 1 from public.employees e where e.id = employee_id and e.active = true)
  and length(trim(video_name)) between 1 and 180
  and length(trim(program_name)) between 1 and 180
);

-- فعّل بث التحديثات الفورية
do $$
begin
  alter publication supabase_realtime add table public.employees;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.roster_entries;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.settings;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then null;
end $$;

-- بعد إنشاء حساب المدير من Authentication > Users:
-- انسخ UUID الخاص به ونفّذ:
-- insert into public.admin_users(user_id) values ('ضع-UUID-المدير-هنا');
