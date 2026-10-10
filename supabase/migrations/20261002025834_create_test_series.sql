-- Test series (TESTS.md 1.17): a named, ordered list of existing tests for long-running programmes ("Placement Prep –
-- 30 days": Day 1 Aptitude 1, Day 2 Java 1, ...). Individual tests stay as they are; scheduling (a later migration)
-- takes either a single test or a series. A test can be in several series, but only once per series (a batch never
-- gets the same test twice). Superadmin and onboarding managers create, edit and archive series; writes go through
-- the functions below (tables are read-only to the app). Nothing is deleted: series are archived.

create table public.test_series (
  id uuid primary key default gen_random_uuid(),
  title text not null check (btrim(title) <> '' and length(title) <= 100),
  created_by uuid not null references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.profiles(id),
  constraint test_series_archive_pair check ((archived_by is null) = (archived_at is null))
);

-- Titles are unique regardless of case (archived series included).
create unique index test_series_title_key on public.test_series (lower(title));
create index test_series_created_by_idx on public.test_series (created_by);
create index test_series_updated_by_idx on public.test_series (updated_by);
create index test_series_archived_by_idx on public.test_series (archived_by);

create trigger test_series_set_updated_at
  before update on public.test_series
  for each row execute function public.set_updated_at();

-- One row per test in a series; position 1 is the series' first day.
create table public.test_series_items (
  series_id uuid not null references public.test_series(id) on delete cascade,
  test_id uuid not null references public.tests(id) on delete restrict,
  position integer not null check (position between 1 and 365),
  primary key (series_id, test_id),
  unique (series_id, position)
);

create index test_series_items_test_id_idx on public.test_series_items (test_id);

alter table public.test_series enable row level security;
alter table public.test_series_items enable row level security;
-- This project auto-grants full privileges to `authenticated` on new tables; revoke, then grant read only.
revoke all on public.test_series from public, anon, authenticated;
revoke all on public.test_series_items from public, anon, authenticated;
grant select on public.test_series to authenticated;
grant select on public.test_series_items to authenticated;

create policy "test series readable by superadmin and onboarding managers"
  on public.test_series for select to authenticated
  using ((select public.can_manage_tests()));

create policy "test series items readable by superadmin and onboarding managers"
  on public.test_series_items for select to authenticated
  using ((select public.can_manage_tests()));

-- ---------------------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------------------

-- Checks the title and the ordered test list, raising on the first problem. Returns the cleaned title.
create function public.test_series_check(p_series_id uuid, p_title text, p_test_ids uuid[])
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_title text := public.test_clean_title(p_title);
  v_missing integer;
  v_archived text;
begin
  if v_title = '' then
    raise exception 'Title is required';
  end if;
  if length(v_title) > 100 then
    raise exception 'Title can be at most 100 characters';
  end if;
  if exists (
    select 1 from public.test_series where lower(title) = lower(v_title) and id is distinct from p_series_id
  ) then
    raise exception 'A series named "%" already exists', v_title;
  end if;

  if p_test_ids is null or cardinality(p_test_ids) = 0 then
    raise exception 'Add at least one test';
  end if;
  if cardinality(p_test_ids) > 365 then
    raise exception 'A series can have at most 365 tests';
  end if;
  if array_position(p_test_ids, null) is not null then
    raise exception 'A test in the list is not valid';
  end if;
  if (select count(distinct x) from unnest(p_test_ids) x) <> cardinality(p_test_ids) then
    raise exception 'A test can be in a series only once';
  end if;

  select count(*) into v_missing
  from unnest(p_test_ids) x
  where not exists (select 1 from public.tests t where t.id = x);
  if v_missing > 0 then
    raise exception 'A test in the list was not found';
  end if;

  select t.title into v_archived
  from unnest(p_test_ids) x join public.tests t on t.id = x
  where t.archived_at is not null
  limit 1;
  if v_archived is not null then
    raise exception '"%" is archived. Restore it or remove it from the series.', v_archived;
  end if;

  return v_title;
end;
$$;
revoke all on function public.test_series_check(uuid, text, uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Functions the app calls
-- ---------------------------------------------------------------------------------------------------------

-- Creates a series from tests in day order and returns its id.
create function public.test_series_create(p_title text, p_test_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_id uuid;
begin
  if not public.can_manage_tests() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  v_title := public.test_series_check(null, p_title, p_test_ids);

  insert into public.test_series (title, created_by)
  values (v_title, (select auth.uid()))
  returning id into v_id;

  insert into public.test_series_items (series_id, test_id, position)
  select v_id, x.test_id, x.position::integer
  from unnest(p_test_ids) with ordinality as x(test_id, position);

  return v_id;
end;
$$;
revoke all on function public.test_series_create(text, uuid[]) from public, anon;
grant execute on function public.test_series_create(text, uuid[]) to authenticated;

-- Replaces the title and the whole ordered test list. Archived series can't be edited (restore first).
-- Scheduling (later) will also lock a series once one of its schedules has started.
create function public.test_series_update(p_series_id uuid, p_title text, p_test_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_archived timestamptz;
begin
  if not public.can_manage_tests() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select archived_at into v_archived from public.test_series where id = p_series_id for update;
  if not found then
    raise exception 'Series not found';
  end if;
  if v_archived is not null then
    raise exception 'This series is archived. Restore it before editing.';
  end if;
  v_title := public.test_series_check(p_series_id, p_title, p_test_ids);

  update public.test_series set title = v_title, updated_by = (select auth.uid()) where id = p_series_id;

  delete from public.test_series_items where series_id = p_series_id;
  insert into public.test_series_items (series_id, test_id, position)
  select p_series_id, x.test_id, x.position::integer
  from unnest(p_test_ids) with ordinality as x(test_id, position);
end;
$$;
revoke all on function public.test_series_update(uuid, text, uuid[]) from public, anon;
grant execute on function public.test_series_update(uuid, text, uuid[]) to authenticated;

-- Archive (kept for past results, out of new schedules) or restore.
create function public.test_series_set_archived(p_series_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_tests() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_archived is null then
    raise exception 'Say whether to archive or restore';
  end if;
  update public.test_series
  set archived_at = case when p_archived then coalesce(archived_at, now()) end,
      archived_by = case when p_archived then coalesce(archived_by, (select auth.uid())) end
  where id = p_series_id;
  if not found then
    raise exception 'Series not found';
  end if;
end;
$$;
revoke all on function public.test_series_set_archived(uuid, boolean) from public, anon;
grant execute on function public.test_series_set_archived(uuid, boolean) to authenticated;
