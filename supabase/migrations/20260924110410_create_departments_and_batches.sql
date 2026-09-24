-- College structure: every college gets a short unique code, departments sit under a college, and batches
-- under a department. Batch codes are generated (college-dept-number, e.g. SEC-CSE-B01) and never change,
-- because college and department codes are locked once created. Nothing is deleted; old rows are archived.

-- ---------------------------------------------------------------------------------------------------------
-- colleges: short code (unique platform-wide, locked after creation) and name unique per city
-- ---------------------------------------------------------------------------------------------------------
alter table public.colleges add column code text;

-- The only college at the time of writing is the test college "Sairam Engineering College" (Chennai).
update public.colleges set code = 'SEC' where code is null;

alter table public.colleges
  alter column code set not null,
  add constraint colleges_code_format check (code ~ '^[A-Z0-9]{2,10}$');

create unique index colleges_code_key on public.colleges (code);
create unique index colleges_name_city_key on public.colleges (lower(btrim(name)), lower(btrim(city)));

-- `code` is deliberately left out of the column-level update grant (see create_colleges), so it can't change.

drop function public.onboarding_create_college(text, text, text, text, text, text, text, text, text);

create function public.onboarding_create_college(
  p_name text,
  p_code text,
  p_contact_name text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_contact_prefix text default null,
  p_contact_phone_alt text default null,
  p_city text default null,
  p_state text default null,
  p_address text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not (public.is_superadmin() or public.has_role('onboarding_manager')) then
    raise exception 'Not authorized';
  end if;

  insert into public.colleges (name, code, contact_prefix, contact_name, contact_email, contact_phone, contact_phone_alt, city, state, address, created_by)
  values (p_name, upper(btrim(p_code)), p_contact_prefix, p_contact_name, p_contact_email, p_contact_phone, p_contact_phone_alt, p_city, p_state, p_address, (select auth.uid()))
  returning id into v_id;

  if public.has_role('onboarding_manager') then
    insert into public.onboarding_manager_colleges (manager_id, college_id, assigned_by)
    values ((select auth.uid()), v_id, (select auth.uid()));
  end if;

  return v_id;
end;
$$;
revoke all on function public.onboarding_create_college(text, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.onboarding_create_college(text, text, text, text, text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Shared: stamp who archived a row and when (the client only sets or clears archived_at)
-- ---------------------------------------------------------------------------------------------------------
create function public.stamp_archived()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.archived_at is distinct from old.archived_at then
    if new.archived_at is null then
      new.archived_by := null;
    else
      new.archived_at := now();
      new.archived_by := (select auth.uid());
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- departments
-- ---------------------------------------------------------------------------------------------------------
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references public.colleges(id),
  code text not null check (code ~ '^[A-Z0-9]{2,10}$'),
  name text not null check (btrim(name) <> ''),
  archived_at timestamptz,
  archived_by uuid references public.profiles(id),
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (college_id, code),
  -- Target of batches' composite foreign key, so a batch's department always belongs to the batch's college.
  unique (id, college_id)
);

create unique index departments_college_name_key on public.departments (college_id, lower(btrim(name)));

create trigger departments_set_updated_at
  before update on public.departments
  for each row execute function public.set_updated_at();

create trigger departments_stamp_archived
  before update on public.departments
  for each row execute function public.stamp_archived();

alter table public.departments enable row level security;
-- Same default-privilege gotcha as colleges: revoke from authenticated too, then re-grant narrowly.
-- code and college_id are insert-only; created_by/archived_by are stamped by defaults and triggers.
revoke all on public.departments from public, anon, authenticated;
grant select on public.departments to authenticated;
grant insert (college_id, code, name) on public.departments to authenticated;
grant update (name, archived_at) on public.departments to authenticated;

create policy "departments readable by superadmin, support and assigned managers"
  on public.departments for select to authenticated
  using (public.is_superadmin() or public.has_role('support') or public.is_assigned_college(college_id));

create policy "superadmin and assigned managers add departments"
  on public.departments for insert to authenticated
  with check (public.is_superadmin() or public.is_assigned_college(college_id));

create policy "superadmin and assigned managers edit departments"
  on public.departments for update to authenticated
  using (public.is_superadmin() or public.is_assigned_college(college_id))
  with check (public.is_superadmin() or public.is_assigned_college(college_id));

-- ---------------------------------------------------------------------------------------------------------
-- batches
-- ---------------------------------------------------------------------------------------------------------
create table public.batches (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null,
  department_id uuid not null,
  number int not null check (number >= 1),
  code text not null,
  graduation_year int not null check (graduation_year between 2000 and 2100),
  archived_at timestamptz,
  archived_by uuid references public.profiles(id),
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (department_id, college_id) references public.departments (id, college_id),
  unique (department_id, number),
  unique (code)
);

create trigger batches_set_updated_at
  before update on public.batches
  for each row execute function public.set_updated_at();

create trigger batches_stamp_archived
  before update on public.batches
  for each row execute function public.stamp_archived();

-- Fills college_id, number and code from the department. Runs as definer so it can lock the department row
-- (serialising concurrent inserts so two batches never get the same number) whatever the caller's grants.
-- RLS WITH CHECK is evaluated after this, against the filled-in college_id.
create function public.batches_assign_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_college_id uuid;
  v_dept_code text;
  v_college_code text;
  v_archived timestamptz;
begin
  select d.college_id, d.code, c.code, d.archived_at
    into v_college_id, v_dept_code, v_college_code, v_archived
  from public.departments d
  join public.colleges c on c.id = d.college_id
  where d.id = new.department_id
  for update of d;

  if not found then
    raise exception 'Department not found';
  end if;
  if v_archived is not null then
    raise exception 'Department is archived';
  end if;

  new.college_id := v_college_id;
  select coalesce(max(b.number), 0) + 1 into new.number from public.batches b where b.department_id = new.department_id;
  new.code := v_college_code || '-' || v_dept_code || '-B' || lpad(new.number::text, greatest(2, length(new.number::text)), '0');
  return new;
end;
$$;
revoke all on function public.batches_assign_code() from public, anon, authenticated;

create trigger batches_assign_code
  before insert on public.batches
  for each row execute function public.batches_assign_code();

alter table public.batches enable row level security;
-- The client sends only department_id and graduation_year; everything else is filled by the trigger/defaults.
revoke all on public.batches from public, anon, authenticated;
grant select on public.batches to authenticated;
grant insert (department_id, graduation_year) on public.batches to authenticated;
grant update (graduation_year, archived_at) on public.batches to authenticated;

create policy "batches readable by superadmin, support and assigned managers"
  on public.batches for select to authenticated
  using (public.is_superadmin() or public.has_role('support') or public.is_assigned_college(college_id));

create policy "superadmin and assigned managers add batches"
  on public.batches for insert to authenticated
  with check (public.is_superadmin() or public.is_assigned_college(college_id));

create policy "superadmin and assigned managers edit batches"
  on public.batches for update to authenticated
  using (public.is_superadmin() or public.is_assigned_college(college_id))
  with check (public.is_superadmin() or public.is_assigned_college(college_id));
