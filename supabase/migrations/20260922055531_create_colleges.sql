-- Colleges (B2B clients) and which onboarding managers are scoped to which colleges.
-- Writes go through functions (onboarding_create_college, superadmin_set_college_status), not raw
-- inserts, so creation and status changes stay atomic and scoped, matching admin_create_profile's pattern.

create table public.colleges (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  status text not null default 'active' check (status in ('active', 'suspended')),
  contact_name text,
  contact_email text,
  contact_phone text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger colleges_set_updated_at
  before update on public.colleges
  for each row execute function public.set_updated_at();

alter table public.colleges enable row level security;
-- This project auto-grants full column privileges to `authenticated` on new tables, so `update`
-- must be explicitly revoked before re-granting the narrower set (status is superadmin-function-only).
revoke all on public.colleges from public, anon, authenticated;
grant select on public.colleges to authenticated;
grant update (name, contact_name, contact_email, contact_phone) on public.colleges to authenticated;

-- Which onboarding managers can act on which colleges. A manager only sees/edits colleges they're
-- assigned to here (see is_assigned_college()); superadmin and support bypass this via their own role.
create table public.onboarding_manager_colleges (
  manager_id uuid not null references public.profiles(id),
  college_id uuid not null references public.colleges(id),
  assigned_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (manager_id, college_id)
);

alter table public.onboarding_manager_colleges enable row level security;
-- Same default-privilege gotcha as colleges: revoke from authenticated too, then re-grant narrowly.
-- Self-assignment on creation goes through onboarding_create_college() (SECURITY DEFINER, its own
-- privileges); direct insert/delete here is gated by RLS to superadmin only.
revoke all on public.onboarding_manager_colleges from public, anon, authenticated;
grant select, delete on public.onboarding_manager_colleges to authenticated;
grant insert (manager_id, college_id, assigned_by) on public.onboarding_manager_colleges to authenticated;

create or replace function public.is_assigned_college(p_college_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.onboarding_manager_colleges
    where manager_id = (select auth.uid()) and college_id = p_college_id
  );
$$;
revoke all on function public.is_assigned_college(uuid) from public, anon;
grant execute on function public.is_assigned_college(uuid) to authenticated;

-- colleges RLS
create policy "colleges readable by superadmin, support and assigned managers"
  on public.colleges for select to authenticated
  using (public.is_superadmin() or public.has_role('support') or public.is_assigned_college(id));

create policy "superadmin and assigned managers edit college contact details"
  on public.colleges for update to authenticated
  using (public.is_superadmin() or public.is_assigned_college(id))
  with check (public.is_superadmin() or public.is_assigned_college(id));

-- onboarding_manager_colleges RLS
create policy "assignments readable by superadmin, support and the assigned manager"
  on public.onboarding_manager_colleges for select to authenticated
  using (public.is_superadmin() or public.has_role('support') or manager_id = (select auth.uid()));

create policy "superadmin manages college assignments directly"
  on public.onboarding_manager_colleges for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

-- Creates a college. Superadmin or any onboarding manager may call this; a calling manager is
-- auto-assigned to what they just created (mirrors admin_create_profile's atomic profile+role insert).
create or replace function public.onboarding_create_college(
  p_name text,
  p_contact_name text default null,
  p_contact_email text default null,
  p_contact_phone text default null
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

  insert into public.colleges (name, contact_name, contact_email, contact_phone, created_by)
  values (p_name, p_contact_name, p_contact_email, p_contact_phone, (select auth.uid()))
  returning id into v_id;

  if public.has_role('onboarding_manager') then
    insert into public.onboarding_manager_colleges (manager_id, college_id, assigned_by)
    values ((select auth.uid()), v_id, (select auth.uid()));
  end if;

  return v_id;
end;
$$;
revoke all on function public.onboarding_create_college from public, anon;
grant execute on function public.onboarding_create_college to authenticated;

-- Suspend/reactivate is superadmin-only (SIDEBAR.md), so `status` has no client grant above.
create or replace function public.superadmin_set_college_status(p_college_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Not authorized';
  end if;
  if p_status not in ('active', 'suspended') then
    raise exception 'Unknown status';
  end if;

  update public.colleges set status = p_status where id = p_college_id;
  if not found then
    raise exception 'College not found';
  end if;
end;
$$;
revoke all on function public.superadmin_set_college_status from public, anon;
grant execute on function public.superadmin_set_college_status to authenticated;
