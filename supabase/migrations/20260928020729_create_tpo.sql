-- TPO: college-side accounts, separate from staff `profiles` like students and faculty. A college has any number of
-- TPOs. Each gets a locked TPO ID (college code + T + 3 random characters, e.g. SEC-T7K2). A TPO may or may not also be
-- a faculty member: when they are, both rows share one login (the same auth user id), so the app shows both roles
-- and the user switches between them. Both rows must then belong to the same college, and name/phone are kept in step.
-- Accounts are created, edited, reset and (de)activated only through the college-users edge function (service role),
-- so clients get read access only. Nothing is deleted: TPOs are deactivated.
-- A TPO reads their whole college: departments, batches, students, faculty and faculty assignments. Support has no
-- access (owner's call, same as faculty).

-- ---------------------------------------------------------------------------------------------------------
-- tpo_designations: the list a TPO's designation is picked from. Superadmin maintains it.
-- ---------------------------------------------------------------------------------------------------------
create table public.tpo_designations (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null check (btrim(label) <> ''),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index tpo_designations_label_key on public.tpo_designations (lower(btrim(label)));

insert into public.tpo_designations (id, label, sort_order) values
  ('training_placement_officer', 'Training & Placement Officer', 1),
  ('placement_coordinator', 'Placement Coordinator', 2),
  ('assistant_tpo', 'Assistant TPO', 3);

alter table public.tpo_designations enable row level security;
-- Same default-privilege gotcha as colleges: revoke from authenticated too, then re-grant narrowly.
revoke all on public.tpo_designations from public, anon, authenticated;
grant select on public.tpo_designations to authenticated;
grant insert (id, label, sort_order) on public.tpo_designations to authenticated;
grant update (label, sort_order, is_active) on public.tpo_designations to authenticated;

create policy "tpo designations readable by signed-in users"
  on public.tpo_designations for select to authenticated
  using (true);

create policy "superadmin adds tpo designations"
  on public.tpo_designations for insert to authenticated
  with check (public.is_superadmin());

create policy "superadmin edits tpo designations"
  on public.tpo_designations for update to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

-- ---------------------------------------------------------------------------------------------------------
-- tpo
-- ---------------------------------------------------------------------------------------------------------
create table public.tpo (
  id uuid primary key references auth.users (id) on delete restrict,
  college_id uuid not null references public.colleges (id),
  code text not null check (code ~ '^[A-Z0-9]{2,10}-T[A-Z0-9]{3}$'),
  full_name text not null check (btrim(full_name) <> ''),
  email text not null check (email = lower(btrim(email)) and email <> ''),
  phone text check (btrim(phone) <> ''),
  designation_id text references public.tpo_designations (id),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index tpo_code_key on public.tpo (code);
create unique index tpo_email_key on public.tpo (email);
create index tpo_college_id_idx on public.tpo (college_id);

create trigger tpo_set_updated_at
  before update on public.tpo
  for each row execute function public.set_updated_at();

alter table public.tpo enable row level security;
revoke all on public.tpo from public, anon, authenticated;
grant select on public.tpo to authenticated;

create policy "tpo readable by superadmin, assigned managers and themselves"
  on public.tpo for select to authenticated
  using (
    id = (select auth.uid())
    or public.is_superadmin()
    or public.is_assigned_college(college_id)
  );

-- ---------------------------------------------------------------------------------------------------------
-- One login as both faculty and TPO: same college, same email, name/phone kept in step
-- ---------------------------------------------------------------------------------------------------------

-- Checked on insert into either table, so the rule holds whichever row comes first. College and email never change.
create function public.tpo_faculty_check_same_person()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_college_id uuid;
  v_email text;
begin
  if tg_table_name = 'tpo' then
    select college_id, email into v_college_id, v_email from public.faculty where id = new.id;
  else
    select college_id, email into v_college_id, v_email from public.tpo where id = new.id;
  end if;
  if found and (v_college_id <> new.college_id or v_email <> new.email) then
    raise exception 'Faculty and TPO roles of one account must be in the same college';
  end if;
  return new;
end;
$$;
revoke all on function public.tpo_faculty_check_same_person() from public, anon, authenticated;

create trigger tpo_check_same_person
  before insert on public.tpo
  for each row execute function public.tpo_faculty_check_same_person();

create trigger faculty_check_same_person
  before insert on public.faculty
  for each row execute function public.tpo_faculty_check_same_person();

-- An edit to one row's name or phone is copied to the other row of the same person. The "is distinct from" guard
-- stops the copy bouncing back.
create function public.tpo_faculty_sync_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'tpo' then
    update public.faculty set full_name = new.full_name, phone = new.phone
    where id = new.id and (full_name, phone) is distinct from (new.full_name, new.phone);
  else
    update public.tpo set full_name = new.full_name, phone = new.phone
    where id = new.id and (full_name, phone) is distinct from (new.full_name, new.phone);
  end if;
  return null;
end;
$$;
revoke all on function public.tpo_faculty_sync_details() from public, anon, authenticated;

create trigger tpo_sync_details
  after update of full_name, phone on public.tpo
  for each row execute function public.tpo_faculty_sync_details();

create trigger faculty_sync_details
  after update of full_name, phone on public.faculty
  for each row execute function public.tpo_faculty_sync_details();

-- ---------------------------------------------------------------------------------------------------------
-- TPO read rules (definer helper, so policies can use it without recursing into RLS)
-- ---------------------------------------------------------------------------------------------------------

-- The signed-in user's college when they are an active TPO, else null.
create function public.my_tpo_college_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.college_id from public.tpo t where t.id = (select auth.uid()) and t.status = 'active';
$$;
revoke all on function public.my_tpo_college_id() from public, anon;
grant execute on function public.my_tpo_college_id() to authenticated;

-- A TPO reads their whole college (institution-wide view), including who teaches which batch.
create policy "tpo read their college"
  on public.colleges for select to authenticated
  using (id = (select public.my_tpo_college_id()));

create policy "tpo read their college's departments"
  on public.departments for select to authenticated
  using (college_id = (select public.my_tpo_college_id()));

create policy "tpo read their college's batches"
  on public.batches for select to authenticated
  using (college_id = (select public.my_tpo_college_id()));

create policy "tpo read their college's students"
  on public.students for select to authenticated
  using (college_id = (select public.my_tpo_college_id()));

create policy "tpo read their college's faculty"
  on public.faculty for select to authenticated
  using (college_id = (select public.my_tpo_college_id()));

create policy "tpo read their college's faculty assignments"
  on public.faculty_batches for select to authenticated
  using (college_id = (select public.my_tpo_college_id()));

-- ---------------------------------------------------------------------------------------------------------
-- Writes (service role only; the college-users edge function checks the caller first)
-- ---------------------------------------------------------------------------------------------------------

create function public.tpo_check_designation(p_designation_id text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_designation_id is not null and not exists (
    select 1 from public.tpo_designations d where d.id = p_designation_id and d.is_active
  ) then
    raise exception 'Designation not found';
  end if;
end;
$$;
revoke all on function public.tpo_check_designation(text) from public, anon, authenticated;

-- Inserts the TPO row and returns the generated TPO ID. p_id is either an auth user the edge function just created,
-- or an existing faculty member's login (see college_make_faculty_tpo). Same 31-character set as faculty IDs.
create function public.college_create_tpo(
  p_id uuid,
  p_college_id uuid,
  p_full_name text,
  p_email text,
  p_phone text,
  p_designation_id text,
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
  perform public.tpo_check_designation(p_designation_id);

  loop
    v_attempt := v_attempt + 1;
    v_code := v_college_code || '-T'
      || substr(v_chars, 1 + floor(random() * 31)::int, 1)
      || substr(v_chars, 1 + floor(random() * 31)::int, 1)
      || substr(v_chars, 1 + floor(random() * 31)::int, 1);
    begin
      insert into public.tpo (id, college_id, code, full_name, email, phone, designation_id, created_by)
      values (p_id, p_college_id, v_code, btrim(p_full_name), lower(btrim(p_email)), nullif(btrim(p_phone), ''),
              p_designation_id, p_created_by);
      return v_code;
    exception when unique_violation then
      -- Only a clashing TPO ID is retried; a clashing email or id is a real error.
      if sqlerrm not like '%tpo_code_key%' or v_attempt >= 50 then
        raise;
      end if;
    end;
  end loop;
end;
$$;
revoke all on function public.college_create_tpo(uuid, uuid, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.college_create_tpo(uuid, uuid, text, text, text, text, uuid) to service_role;

-- Makes an existing, active faculty member a TPO of their own college on the same login (no new account or
-- password). Name, email and phone are taken from the faculty row. Returns the generated TPO ID.
create function public.college_make_faculty_tpo(p_faculty_id uuid, p_designation_id text, p_created_by uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_faculty public.faculty%rowtype;
begin
  select * into v_faculty from public.faculty where id = p_faculty_id for update;
  if not found then
    raise exception 'Faculty not found';
  end if;
  if v_faculty.status <> 'active' then
    raise exception 'Faculty is inactive';
  end if;
  if exists (select 1 from public.tpo where id = p_faculty_id) then
    raise exception 'Already a TPO';
  end if;
  return public.college_create_tpo(p_faculty_id, v_faculty.college_id, v_faculty.full_name, v_faculty.email,
                                   v_faculty.phone, p_designation_id, p_created_by);
end;
$$;
revoke all on function public.college_make_faculty_tpo(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.college_make_faculty_tpo(uuid, text, uuid) to service_role;

-- Edits a TPO's details. Email, college and TPO ID never change. Name and phone also update the faculty row of the
-- same person, if there is one (trigger above).
create function public.college_update_tpo(p_id uuid, p_full_name text, p_phone text, p_designation_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_designation_id text;
begin
  select designation_id into v_designation_id from public.tpo where id = p_id for update;
  if not found then
    raise exception 'TPO not found';
  end if;
  -- Only a changed designation is checked, so keeping one that was retired since is allowed.
  perform public.tpo_check_designation(
    case when p_designation_id is distinct from v_designation_id then p_designation_id end
  );

  update public.tpo
  set full_name = btrim(p_full_name),
      phone = nullif(btrim(p_phone), ''),
      designation_id = p_designation_id
  where id = p_id;
end;
$$;
revoke all on function public.college_update_tpo(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.college_update_tpo(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------------------------------------
-- Sign-in: role lookup and the TPO's own Profile
-- ---------------------------------------------------------------------------------------------------------

-- Staff roles from user_roles, plus 'student' / 'faculty' / 'tpo' for an active account of that kind. A login that is
-- both faculty and TPO gets both.
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
  select 'faculty' from public.faculty f where f.id = (select auth.uid()) and f.status = 'active'
  union
  select 'tpo' from public.tpo t where t.id = (select auth.uid()) and t.status = 'active';
$$;

-- The signed-in TPO's own details with their college and designation, for the Profile page. Empty for anyone else.
create function public.my_tpo_profile()
returns table (
  full_name text,
  email text,
  phone text,
  code text,
  status text,
  created_at timestamptz,
  college_code text,
  college_name text,
  designation text
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.full_name, t.email, t.phone, t.code, t.status, t.created_at, c.code, c.name, d.label
  from public.tpo t
  join public.colleges c on c.id = t.college_id
  left join public.tpo_designations d on d.id = t.designation_id
  where t.id = (select auth.uid());
$$;
revoke all on function public.my_tpo_profile() from public, anon;
grant execute on function public.my_tpo_profile() to authenticated;
