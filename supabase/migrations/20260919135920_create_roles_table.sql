create table public.roles (
  id text primary key,
  label text not null,
  description text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.roles enable row level security;

-- Any signed-in user can read roles; writes only via service role / migrations for now.
create policy "roles are readable by authenticated users"
  on public.roles for select
  to authenticated
  using (true);

insert into public.roles (id, label, description, sort_order) values
  ('superadmin', 'Superadmin', 'Full access; monitors platform health and business metrics', 1),
  ('manager', 'Manager', 'Manages internal team accounts, schedules tests to batches, oversees content pipeline', 2),
  ('content_creator', 'Content creator', 'Creates MCQ questions for the question bank', 3),
  ('content_reviewer', 'Content reviewer', 'Verifies questions before they are eligible for tests', 4),
  ('onboarding_manager', 'Onboarding manager', 'Onboards colleges, sets up depts/batches, creates TPO and faculty accounts', 5),
  ('support', 'Support', 'Read access across the platform plus account-level actions to resolve tickets', 6),
  ('tpo', 'TPO', 'Institution-wide analytics and results for a college', 7),
  ('faculty', 'Faculty', 'Analytics and results for assigned batch(es)', 8),
  ('student', 'Student', 'Attends scheduled tests and sees own results and analytics', 9);
