create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_by uuid references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Category names are unique regardless of case/whitespace.
create unique index categories_name_key on public.categories (lower(btrim(name)));
create index categories_created_by_idx on public.categories (created_by);

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

alter table public.categories enable row level security;

-- Any signed-in user can read categories (needed later by content roles and tests).
create policy "categories readable by authenticated"
  on public.categories for select
  to authenticated
  using (true);

-- Only superadmins can add or edit. No delete policy: categories are never deleted.
create policy "superadmin can insert categories"
  on public.categories for insert
  to authenticated
  with check ((select public.is_superadmin()));

create policy "superadmin can update categories"
  on public.categories for update
  to authenticated
  using ((select public.is_superadmin()))
  with check ((select public.is_superadmin()));
