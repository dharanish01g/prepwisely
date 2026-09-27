-- Faculty: college-side accounts, kept separate from staff `profiles` (decided 2026-09-22), like students. A faculty
-- member belongs to one college, gets a locked faculty ID (college code + F + 3 random characters, e.g. SEC-F7K2), and
-- is assigned to any number of that college's batches. Department and current role are optional and always linked
-- (no free text). Accounts are created, edited, reset, (de)activated and assigned only through the college-users edge
-- function (service role), so clients get read access only. Nothing is deleted: faculty are deactivated, and
-- unassigning a batch stamps the assignment instead of removing it, so the full history stays.

-- ---------------------------------------------------------------------------------------------------------
-- faculty_roles: the list a faculty member's current role is picked from. Superadmin maintains it.
-- ---------------------------------------------------------------------------------------------------------
create table public.faculty_roles (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null check (btrim(label) <> ''),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index faculty_roles_label_key on public.faculty_roles (lower(btrim(label)));

insert into public.faculty_roles (id, label, sort_order) values
  ('professor', 'Professor', 1),
  ('associate_professor', 'Associate Professor', 2),
  ('assistant_professor', 'Assistant Professor', 3),
  ('head_of_department', 'Head of Department', 4),
  ('lecturer', 'Lecturer', 5),
  ('placement_trainer', 'Placement Trainer', 6);

alter table public.faculty_roles enable row level security;
-- Same default-privilege gotcha as colleges: revoke from authenticated too, then re-grant narrowly. Roles are
-- retired with is_active, never deleted, and the id is insert-only.
revoke all on public.faculty_roles from public, anon, authenticated;
grant select on public.faculty_roles to authenticated;
grant insert (id, label, sort_order) on public.faculty_roles to authenticated;
grant update (label, sort_order, is_active) on public.faculty_roles to authenticated;

create policy "faculty roles readable by signed-in users"
  on public.faculty_roles for select to authenticated
  using (true);

create policy "superadmin adds faculty roles"
  on public.faculty_roles for insert to authenticated
  with check (public.is_superadmin());

create policy "superadmin edits faculty roles"
  on public.faculty_roles for update to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

-- ---------------------------------------------------------------------------------------------------------
-- faculty
-- ---------------------------------------------------------------------------------------------------------
create table public.faculty (
  id uuid primary key references auth.users (id) on delete restrict,
  college_id uuid not null references public.colleges (id),
  code text not null check (code ~ '^[A-Z0-9]{2,10}-F[A-Z0-9]{3}$'),
  full_name text not null check (btrim(full_name) <> ''),
  email text not null check (email = lower(btrim(email)) and email <> ''),
  phone text check (btrim(phone) <> ''),
  department_id uuid,
  faculty_role_id text references public.faculty_roles (id),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The department, when set, must belong to the faculty member's college.
  foreign key (department_id, college_id) references public.departments (id, college_id),
  -- Target of faculty_batches' composite foreign key.
  unique (id, college_id)
);

create unique index faculty_code_key on public.faculty (code);
create unique index faculty_email_key on public.faculty (email);
create index faculty_college_id_idx on public.faculty (college_id);
create index faculty_department_id_idx on public.faculty (department_id);

create trigger faculty_set_updated_at
  before update on public.faculty
  for each row execute function public.set_updated_at();

alter table public.faculty enable row level security;
revoke all on public.faculty from public, anon, authenticated;
grant select on public.faculty to authenticated;

create policy "faculty readable by superadmin, assigned managers and themselves"
  on public.faculty for select to authenticated
  using (
    id = (select auth.uid())
    or public.is_superadmin()
    or public.is_assigned_college(college_id)
  );

-- ---------------------------------------------------------------------------------------------------------
-- faculty_batches: one row per assignment. Unassigning stamps unassigned_at/by; re-assigning adds a new row.
-- ---------------------------------------------------------------------------------------------------------
create table public.faculty_batches (
  id uuid primary key default gen_random_uuid(),
  faculty_id uuid not null,
  batch_id uuid not null,
  college_id uuid not null,
  assigned_by uuid not null references public.profiles (id),
  assigned_at timestamptz not null default now(),
  unassigned_by uuid references public.profiles (id),
  unassigned_at timestamptz,
  -- Faculty and batch must both belong to the assignment's college.
  foreign key (faculty_id, college_id) references public.faculty (id, college_id),
  foreign key (batch_id, college_id) references public.batches (id, college_id),
  check ((unassigned_at is null) = (unassigned_by is null))
);

-- A batch can be assigned to the same faculty member only once at a time.
create unique index faculty_batches_active_key on public.faculty_batches (faculty_id, batch_id) where unassigned_at is null;
create index faculty_batches_faculty_id_idx on public.faculty_batches (faculty_id);
create index faculty_batches_batch_id_idx on public.faculty_batches (batch_id);

alter table public.faculty_batches enable row level security;
revoke all on public.faculty_batches from public, anon, authenticated;
grant select on public.faculty_batches to authenticated;

create policy "faculty assignments readable by superadmin, assigned managers and the faculty member"
  on public.faculty_batches for select to authenticated
  using (
    faculty_id = (select auth.uid())
    or public.is_superadmin()
    or public.is_assigned_college(college_id)
  );

-- ---------------------------------------------------------------------------------------------------------
-- Helpers for faculty read rules (definer, so policies can use them without recursing into RLS)
-- ---------------------------------------------------------------------------------------------------------

-- The signed-in user's college when they are an active faculty member, else null.
create function public.my_faculty_college_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select f.college_id from public.faculty f where f.id = (select auth.uid()) and f.status = 'active';
$$;
revoke all on function public.my_faculty_college_id() from public, anon;
grant execute on function public.my_faculty_college_id() to authenticated;

-- True when the signed-in user is an active faculty member currently assigned to the batch.
create function public.is_assigned_batch(p_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.faculty_batches fb
    join public.faculty f on f.id = fb.faculty_id
    where fb.faculty_id = (select auth.uid())
      and fb.batch_id = p_batch_id
      and fb.unassigned_at is null
      and f.status = 'active'
  );
$$;
revoke all on function public.is_assigned_batch(uuid) from public, anon;
grant execute on function public.is_assigned_batch(uuid) to authenticated;

-- Faculty read their own college and its departments, their assigned batches, and every detail of the students in
-- those batches. Other faculty, other batches and other colleges stay hidden.
create policy "faculty read their college"
  on public.colleges for select to authenticated
  using (id = (select public.my_faculty_college_id()));

create policy "faculty read their college's departments"
  on public.departments for select to authenticated
  using (college_id = (select public.my_faculty_college_id()));

create policy "faculty read their assigned batches"
  on public.batches for select to authenticated
  using (public.is_assigned_batch(id));

create policy "faculty read students in their assigned batches"
  on public.students for select to authenticated
  using (public.is_assigned_batch(batch_id));

-- ---------------------------------------------------------------------------------------------------------
-- Writes (service role only; the college-users edge function checks the caller first)
-- ---------------------------------------------------------------------------------------------------------

-- Checks a department and role for a faculty member of the given college. Raises a readable error otherwise.
create function public.faculty_check_links(p_college_id uuid, p_department_id uuid, p_faculty_role_id text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_department_id is not null and not exists (
    select 1 from public.departments d
    where d.id = p_department_id and d.college_id = p_college_id and d.archived_at is null
  ) then
    raise exception 'Department not found';
  end if;
  if p_faculty_role_id is not null and not exists (
    select 1 from public.faculty_roles r where r.id = p_faculty_role_id and r.is_active
  ) then
    raise exception 'Faculty role not found';
  end if;
end;
$$;
revoke all on function public.faculty_check_links(uuid, uuid, text) from public, anon, authenticated;

-- Inserts the faculty row for an auth user the edge function just created and returns the generated faculty ID.
-- The 3 characters leave out look-alikes (0/O, 1/I/L), giving 31^3 = 29,791 IDs per college.
create function public.college_create_faculty(
  p_id uuid,
  p_college_id uuid,
  p_full_name text,
  p_email text,
  p_phone text,
  p_department_id uuid,
  p_faculty_role_id text,
  p_created_by uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_college_code text;
  v_code text;
  v_chars constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_attempt int := 0;
begin
  select code into v_college_code from public.colleges where id = p_college_id;
  if not found then
    raise exception 'College not found';
  end if;
  perform public.faculty_check_links(p_college_id, p_department_id, p_faculty_role_id);

  loop
    v_attempt := v_attempt + 1;
    v_code := v_college_code || '-F'
      || substr(v_chars, 1 + floor(random() * 31)::int, 1)
      || substr(v_chars, 1 + floor(random() * 31)::int, 1)
      || substr(v_chars, 1 + floor(random() * 31)::int, 1);
    begin
      insert into public.faculty (id, college_id, code, full_name, email, phone, department_id, faculty_role_id, created_by)
      values (p_id, p_college_id, v_code, btrim(p_full_name), lower(btrim(p_email)), nullif(btrim(p_phone), ''),
              p_department_id, p_faculty_role_id, p_created_by);
      return v_code;
    exception when unique_violation then
      -- Only a clashing faculty ID is retried; a clashing email or id is a real error.
      if sqlerrm not like '%faculty_code_key%' or v_attempt >= 50 then
        raise;
      end if;
    end;
  end loop;
end;
$$;
revoke all on function public.college_create_faculty(uuid, uuid, text, text, text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.college_create_faculty(uuid, uuid, text, text, text, uuid, text, uuid) to service_role;

-- Edits a faculty member's details. Email, college and faculty ID never change.
create function public.college_update_faculty(
  p_id uuid,
  p_full_name text,
  p_phone text,
  p_department_id uuid,
  p_faculty_role_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_college_id uuid;
  v_department_id uuid;
  v_faculty_role_id text;
begin
  select college_id, department_id, faculty_role_id into v_college_id, v_department_id, v_faculty_role_id
  from public.faculty where id = p_id for update;
  if not found then
    raise exception 'Faculty not found';
  end if;
  -- Only a changed department/role is checked, so keeping one that was archived/retired since is allowed.
  perform public.faculty_check_links(
    v_college_id,
    case when p_department_id is distinct from v_department_id then p_department_id end,
    case when p_faculty_role_id is distinct from v_faculty_role_id then p_faculty_role_id end
  );

  update public.faculty
  set full_name = btrim(p_full_name),
      phone = nullif(btrim(p_phone), ''),
      department_id = p_department_id,
      faculty_role_id = p_faculty_role_id
  where id = p_id;
end;
$$;
revoke all on function public.college_update_faculty(uuid, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.college_update_faculty(uuid, text, text, uuid, text) to service_role;

-- Assigns several batches at once, all or nothing. Refuses an inactive faculty member, a batch from another college,
-- an archived batch, a batch listed twice, and a batch already assigned to them. Returns how many were assigned.
create function public.college_assign_faculty_batches(p_faculty_id uuid, p_batch_ids uuid[], p_assigned_by uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_college_id uuid;
  v_status text;
  v_bad text;
begin
  select college_id, status into v_college_id, v_status from public.faculty where id = p_faculty_id for update;
  if not found then
    raise exception 'Faculty not found';
  end if;
  if v_status <> 'active' then
    raise exception 'Faculty is inactive';
  end if;
  if coalesce(cardinality(p_batch_ids), 0) = 0 then
    raise exception 'No batches to assign';
  end if;
  if cardinality(p_batch_ids) <> (select count(distinct x) from unnest(p_batch_ids) x) then
    raise exception 'A batch is listed more than once';
  end if;
  if exists (
    select 1 from unnest(p_batch_ids) x
    where not exists (select 1 from public.batches b where b.id = x and b.college_id = v_college_id)
  ) then
    raise exception 'Batch not found';
  end if;

  select string_agg(b.code, ', ' order by b.code) into v_bad
  from public.batches b where b.id = any (p_batch_ids) and b.archived_at is not null;
  if v_bad is not null then
    raise exception 'Archived batch: %', v_bad;
  end if;

  select string_agg(b.code, ', ' order by b.code) into v_bad
  from public.faculty_batches fb join public.batches b on b.id = fb.batch_id
  where fb.faculty_id = p_faculty_id and fb.batch_id = any (p_batch_ids) and fb.unassigned_at is null;
  if v_bad is not null then
    raise exception 'Already assigned: %', v_bad;
  end if;

  insert into public.faculty_batches (faculty_id, batch_id, college_id, assigned_by)
  select p_faculty_id, x, v_college_id, p_assigned_by from unnest(p_batch_ids) x;
  return cardinality(p_batch_ids);
end;
$$;
revoke all on function public.college_assign_faculty_batches(uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.college_assign_faculty_batches(uuid, uuid[], uuid) to service_role;

-- Ends a current assignment (kept on record with who ended it and when).
create function public.college_unassign_faculty_batch(p_faculty_id uuid, p_batch_id uuid, p_unassigned_by uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.faculty_batches
  set unassigned_at = now(), unassigned_by = p_unassigned_by
  where faculty_id = p_faculty_id and batch_id = p_batch_id and unassigned_at is null;
  if not found then
    raise exception 'Assignment not found';
  end if;
end;
$$;
revoke all on function public.college_unassign_faculty_batch(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.college_unassign_faculty_batch(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------------------------------------
-- Sign-in: role lookup and the faculty member's own Profile
-- ---------------------------------------------------------------------------------------------------------

-- Staff roles from user_roles, plus 'student' / 'faculty' for an active student / faculty account.
create or replace function public.my_role_ids()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select ur.role_id from public.user_roles ur where ur.user_id = (select auth.uid())
  union
  select 'student' from public.students s where s.id = (select auth.uid()) and s.status = 'active'
  union
  select 'faculty' from public.faculty f where f.id = (select auth.uid()) and f.status = 'active';
$$;

-- The signed-in faculty member's own details with their college, department and role, for the Profile page.
-- Their batches come from faculty_batches + batches, which they can read directly. Empty for anyone else.
create function public.my_faculty_profile()
returns table (
  full_name text,
  email text,
  phone text,
  code text,
  status text,
  created_at timestamptz,
  college_code text,
  college_name text,
  department_code text,
  department_name text,
  faculty_role text
)
language sql
stable
security definer
set search_path = ''
as $$
  select f.full_name, f.email, f.phone, f.code, f.status, f.created_at,
         c.code, c.name, d.code, d.name, r.label
  from public.faculty f
  join public.colleges c on c.id = f.college_id
  left join public.departments d on d.id = f.department_id
  left join public.faculty_roles r on r.id = f.faculty_role_id
  where f.id = (select auth.uid());
$$;
revoke all on function public.my_faculty_profile() from public, anon;
grant execute on function public.my_faculty_profile() to authenticated;
