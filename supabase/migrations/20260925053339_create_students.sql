-- Students: college-side accounts, kept separate from staff `profiles` (decided 2026-09-22). Each student belongs to
-- exactly one batch (which fixes their department and college). They sign in with email + password; the first
-- password is their roll number (set by the college-users edge function) and changing it is optional.
-- Accounts are created, reset and (de)activated only through the college-users edge function (service role), so
-- clients get read access only. Nothing is deleted; students are deactivated.

-- Target of students' composite foreign key, so a student's batch always belongs to the student's college.
alter table public.batches add constraint batches_id_college_id_key unique (id, college_id);

create table public.students (
  id uuid primary key references auth.users (id) on delete restrict,
  college_id uuid not null,
  batch_id uuid not null,
  full_name text not null check (btrim(full_name) <> ''),
  email text not null check (email = lower(btrim(email)) and email <> ''),
  roll_number text not null check (roll_number = btrim(roll_number) and char_length(roll_number) between 1 and 30),
  phone text not null check (btrim(phone) <> ''),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (batch_id, college_id) references public.batches (id, college_id)
);

create unique index students_email_key on public.students (email);
-- A roll number is unique within its college, ignoring case.
create unique index students_college_roll_key on public.students (college_id, lower(roll_number));
create index students_batch_id_idx on public.students (batch_id);

create trigger students_set_updated_at
  before update on public.students
  for each row execute function public.set_updated_at();

alter table public.students enable row level security;
revoke all on public.students from public, anon, authenticated;
grant select on public.students to authenticated;

create policy "students readable by superadmin, support, assigned managers and themselves"
  on public.students for select to authenticated
  using (
    id = (select auth.uid())
    or public.is_superadmin()
    or public.has_role('support')
    or public.is_assigned_college(college_id)
  );

-- Inserts the student row for an auth user the edge function just created. Service role only. Refuses an archived
-- batch; the college comes from the batch.
create function public.college_create_student(
  p_id uuid,
  p_batch_id uuid,
  p_full_name text,
  p_email text,
  p_roll_number text,
  p_phone text,
  p_created_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_college_id uuid;
  v_archived timestamptz;
begin
  select college_id, archived_at into v_college_id, v_archived from public.batches where id = p_batch_id;
  if not found then
    raise exception 'Batch not found';
  end if;
  if v_archived is not null then
    raise exception 'Batch is archived';
  end if;

  insert into public.students (id, college_id, batch_id, full_name, email, roll_number, phone, created_by)
  values (p_id, v_college_id, p_batch_id, btrim(p_full_name), lower(btrim(p_email)), btrim(p_roll_number), btrim(p_phone), p_created_by);
end;
$$;
revoke all on function public.college_create_student(uuid, uuid, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.college_create_student(uuid, uuid, text, text, text, text, uuid) to service_role;

-- The signed-in user's role ids: staff roles from user_roles, plus 'student' for an active student account.
-- The app's sidebar uses this (students have no staff profile, so they have no user_roles rows).
create function public.my_role_ids()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select ur.role_id from public.user_roles ur where ur.user_id = (select auth.uid())
  union
  select 'student' from public.students s where s.id = (select auth.uid()) and s.status = 'active';
$$;
revoke all on function public.my_role_ids() from public, anon;
grant execute on function public.my_role_ids() to authenticated;
