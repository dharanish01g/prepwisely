-- Staff profiles (one row per auth user). No deletes anywhere: FKs are RESTRICT and no delete policies exist.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  full_name text not null,
  email text not null unique,
  phone text,
  address text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Join table so a user can hold multiple roles later; the UI assigns one for now.
create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete restrict,
  role_id text not null references public.roles (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create index user_roles_role_id_idx on public.user_roles (role_id);
create index profiles_created_by_idx on public.profiles (created_by);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- True when the calling user is an active superadmin. SECURITY DEFINER so policies can use it without recursing into RLS.
create function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = (select auth.uid())
      and ur.role_id = 'superadmin'
      and p.status = 'active'
  );
$$;

revoke execute on function public.is_superadmin() from public, anon;
grant execute on function public.is_superadmin() to authenticated;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;

-- Read-only from the client. All writes go through Edge Functions using the service role.
create policy "read own profile or any as superadmin"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()) or (select public.is_superadmin()));

create policy "read own roles or any as superadmin"
  on public.user_roles for select
  to authenticated
  using (user_id = (select auth.uid()) or (select public.is_superadmin()));
