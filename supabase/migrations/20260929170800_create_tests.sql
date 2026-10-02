-- Tests (TESTS.md 1.14): a test is created first (title, duration, topics with a question count each) and scheduled
-- to a college's batches later (a separate migration). Questions are never picked by hand: each topic's count is
-- split 50% hard / 30% medium / 20% easy, and students get random questions from those pools when they take it.
-- Superadmin and onboarding managers create, edit and archive tests; nobody else can read them yet.
-- Writes go through the functions below (tables are read-only to the app). Nothing is deleted: tests are archived.

-- ---------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------

create table public.tests (
  id uuid primary key default gen_random_uuid(),
  -- Typed by hand (e.g. "Aptitude 12"); no automatic numbering.
  title text not null check (btrim(title) <> '' and length(title) <= 100),
  duration_minutes integer not null check (duration_minutes between 30 and 180),
  created_by uuid not null references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.profiles(id),
  constraint tests_archive_pair check ((archived_by is null) = (archived_at is null))
);

-- Titles are unique regardless of case (archived tests included, so past results never share a name).
create unique index tests_title_key on public.tests (lower(title));
create index tests_created_by_idx on public.tests (created_by);
create index tests_updated_by_idx on public.tests (updated_by);
create index tests_archived_by_idx on public.tests (archived_by);

create trigger tests_set_updated_at
  before update on public.tests
  for each row execute function public.set_updated_at();

-- One row per topic of a test. The difficulty split is stored when the test is saved, so a later change to the
-- 50/30/20 rule never changes an existing test.
create table public.test_topics (
  test_id uuid not null references public.tests(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete restrict,
  sort_order integer not null check (sort_order >= 1),
  question_count integer not null check (question_count between 1 and 100),
  hard_count integer not null check (hard_count >= 0),
  medium_count integer not null check (medium_count >= 0),
  easy_count integer not null check (easy_count >= 0),
  primary key (test_id, category_id),
  constraint test_topics_split_total check (hard_count + medium_count + easy_count = question_count),
  unique (test_id, sort_order)
);

create index test_topics_category_id_idx on public.test_topics (category_id);

-- ---------------------------------------------------------------------------------------------------------
-- Read access: superadmin and onboarding managers (tests aren't tied to a college until scheduled)
-- ---------------------------------------------------------------------------------------------------------

create function public.can_manage_tests()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_superadmin() or public.has_role('onboarding_manager');
$$;
revoke all on function public.can_manage_tests() from public, anon;
grant execute on function public.can_manage_tests() to authenticated;

alter table public.tests enable row level security;
alter table public.test_topics enable row level security;
-- This project auto-grants full privileges to `authenticated` on new tables; revoke, then grant read only.
revoke all on public.tests from public, anon, authenticated;
revoke all on public.test_topics from public, anon, authenticated;
grant select on public.tests to authenticated;
grant select on public.test_topics to authenticated;

create policy "tests readable by superadmin and onboarding managers"
  on public.tests for select to authenticated
  using ((select public.can_manage_tests()));

create policy "test topics readable by superadmin and onboarding managers"
  on public.test_topics for select to authenticated
  using ((select public.can_manage_tests()));

-- ---------------------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------------------

-- 50% hard, 30% medium, 20% easy: each share rounded down, then what's left goes to hard first, then medium
-- (7 -> 4/2/1, 3 -> 2/1/0, 1 -> 1/0/0). The total always matches.
create function public.test_difficulty_split(p_count integer)
returns table (hard integer, medium integer, easy integer)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_left integer;
begin
  hard := p_count * 5 / 10;
  medium := p_count * 3 / 10;
  easy := p_count * 2 / 10;
  v_left := p_count - hard - medium - easy;
  if v_left >= 1 then hard := hard + 1; end if;
  if v_left >= 2 then medium := medium + 1; end if;
  return next;
end;
$$;
revoke all on function public.test_difficulty_split(integer) from public, anon;
grant execute on function public.test_difficulty_split(integer) to authenticated;

-- A topic's display name, with its parent when it has one ("Technical › Java").
create function public.category_label(p_category_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p.name || ' › ', '') || c.name
  from public.categories c
  left join public.categories p on p.id = c.parent_id
  where c.id = p_category_id;
$$;
revoke all on function public.category_label(uuid) from public, anon;
grant execute on function public.category_label(uuid) to authenticated;

-- Test-eligible questions of a topic, by difficulty: approved, not archived, in the topic or any active
-- subtopic (a retired subtopic doesn't feed tests).
create function public.topic_pool_counts(p_category_id uuid)
returns table (hard integer, medium integer, easy integer)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive tree as (
    select id from public.categories where id = p_category_id and is_active
    union all
    select c.id from public.categories c join tree t on c.parent_id = t.id where c.is_active
  )
  select
    count(*) filter (where q.difficulty = 'hard')::integer,
    count(*) filter (where q.difficulty = 'medium')::integer,
    count(*) filter (where q.difficulty = 'easy')::integer
  from public.questions q
  where q.category_id in (select id from tree)
    and q.status = 'approved'
    and q.archived_at is null;
$$;
revoke all on function public.topic_pool_counts(uuid) from public, anon, authenticated;

-- Reads and checks a topic list: [{"category_id": "...", "question_count": 10}, ...] in display order.
-- Raises on the first problem. Returns one row per topic with its split and how many eligible questions exist.
create function public.test_read_topics(p_topics jsonb)
returns table (
  category_id uuid,
  sort_order integer,
  question_count integer,
  hard_count integer,
  medium_count integer,
  easy_count integer,
  hard_available integer,
  medium_available integer,
  easy_available integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_sort_order integer := 0;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_count integer;
  v_active boolean;
begin
  if p_topics is null or jsonb_typeof(p_topics) <> 'array' or jsonb_array_length(p_topics) = 0 then
    raise exception 'Add at least one topic';
  end if;
  if jsonb_array_length(p_topics) > 20 then
    raise exception 'A test can have at most 20 topics';
  end if;

  for v_item in select value from jsonb_array_elements(p_topics) loop
    v_sort_order := v_sort_order + 1;
    begin
      v_id := (v_item ->> 'category_id')::uuid;
      v_count := (v_item ->> 'question_count')::integer;
    exception when others then
      raise exception 'Topic % is not valid', v_sort_order;
    end;
    if v_id is null then
      raise exception 'Topic % has no category', v_sort_order;
    end if;

    select c.is_active into v_active from public.categories c where c.id = v_id;
    if not found then
      raise exception 'Topic % was not found', v_sort_order;
    end if;
    if not v_active then
      raise exception '% is retired and can''t be used in a test', public.category_label(v_id);
    end if;
    if v_id = any (v_ids) then
      raise exception '% is listed more than once', public.category_label(v_id);
    end if;
    if v_count is null or v_count < 1 or v_count > 100 then
      raise exception '% needs between 1 and 100 questions', public.category_label(v_id);
    end if;
    v_ids := v_ids || v_id;

    category_id := v_id;
    sort_order := v_sort_order;
    question_count := v_count;
    select s.hard, s.medium, s.easy into hard_count, medium_count, easy_count from public.test_difficulty_split(v_count) s;
    select p.hard, p.medium, p.easy into hard_available, medium_available, easy_available
    from public.topic_pool_counts(v_id) p;
    return next;
  end loop;

  -- A topic and one of its own subtopics would share questions, so a question could show up twice in one test.
  if exists (
    with recursive descendants as (
      select c.id, c.id as root from public.categories c where c.id = any (v_ids)
      union all
      select c.id, d.root from public.categories c join descendants d on c.parent_id = d.id
    )
    select 1 from descendants where id <> root and id = any (v_ids)
  ) then
    raise exception 'A topic and one of its subtopics can''t both be in a test. Keep only one of them.';
  end if;
end;
$$;
revoke all on function public.test_read_topics(jsonb) from public, anon, authenticated;

-- Raises when a topic's pool is too small for the test (TESTS.md 1.6): a question never shows twice in one test.
create function public.test_check_pools(p_topics jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t record;
begin
  for t in select * from public.test_read_topics(p_topics) loop
    if t.hard_count > t.hard_available then
      raise exception '% has only % hard question%; this test needs %.',
        public.category_label(t.category_id), t.hard_available, case when t.hard_available = 1 then '' else 's' end, t.hard_count;
    end if;
    if t.medium_count > t.medium_available then
      raise exception '% has only % medium question%; this test needs %.',
        public.category_label(t.category_id), t.medium_available, case when t.medium_available = 1 then '' else 's' end, t.medium_count;
    end if;
    if t.easy_count > t.easy_available then
      raise exception '% has only % easy question%; this test needs %.',
        public.category_label(t.category_id), t.easy_available, case when t.easy_available = 1 then '' else 's' end, t.easy_count;
    end if;
  end loop;
end;
$$;
revoke all on function public.test_check_pools(jsonb) from public, anon, authenticated;

create function public.test_clean_title(p_title text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(btrim(coalesce(p_title, '')), '\s+', ' ', 'g');
$$;
revoke all on function public.test_clean_title(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Functions the app calls
-- ---------------------------------------------------------------------------------------------------------

-- For the test form: each topic's split next to how many eligible questions it has, so the page can warn before
-- saving. Raises on an invalid topic list (same rules as saving), but not on a pool that's too small.
create function public.test_pool_status(p_topics jsonb)
returns table (
  category_id uuid,
  question_count integer,
  hard_count integer,
  medium_count integer,
  easy_count integer,
  hard_available integer,
  medium_available integer,
  easy_available integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_tests() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select t.category_id, t.question_count, t.hard_count, t.medium_count, t.easy_count,
           t.hard_available, t.medium_available, t.easy_available
    from public.test_read_topics(p_topics) t
    order by t.sort_order;
end;
$$;
revoke all on function public.test_pool_status(jsonb) from public, anon;
grant execute on function public.test_pool_status(jsonb) to authenticated;

create function public.test_create(p_title text, p_duration_minutes integer, p_topics jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := public.test_clean_title(p_title);
  v_id uuid;
begin
  if not public.can_manage_tests() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if v_title = '' then
    raise exception 'Title is required';
  end if;
  if length(v_title) > 100 then
    raise exception 'Title can be at most 100 characters';
  end if;
  if p_duration_minutes is null or p_duration_minutes not between 30 and 180 then
    raise exception 'Duration must be between 30 and 180 minutes';
  end if;
  if exists (select 1 from public.tests where lower(title) = lower(v_title)) then
    raise exception 'A test named "%" already exists', v_title;
  end if;
  perform public.test_check_pools(p_topics);

  insert into public.tests (title, duration_minutes, created_by)
  values (v_title, p_duration_minutes, (select auth.uid()))
  returning id into v_id;

  insert into public.test_topics (test_id, category_id, sort_order, question_count, hard_count, medium_count, easy_count)
  select v_id, t.category_id, t.sort_order, t.question_count, t.hard_count, t.medium_count, t.easy_count
  from public.test_read_topics(p_topics) t;

  return v_id;
end;
$$;
revoke all on function public.test_create(text, integer, jsonb) from public, anon;
grant execute on function public.test_create(text, integer, jsonb) to authenticated;

-- Replaces title, duration and the whole topic list. Archived tests can't be edited (restore first).
-- Scheduling (later) will also lock a test once one of its schedules has started.
create function public.test_update(p_test_id uuid, p_title text, p_duration_minutes integer, p_topics jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := public.test_clean_title(p_title);
  v_archived timestamptz;
begin
  if not public.can_manage_tests() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select archived_at into v_archived from public.tests where id = p_test_id for update;
  if not found then
    raise exception 'Test not found';
  end if;
  if v_archived is not null then
    raise exception 'This test is archived. Restore it before editing.';
  end if;
  if v_title = '' then
    raise exception 'Title is required';
  end if;
  if length(v_title) > 100 then
    raise exception 'Title can be at most 100 characters';
  end if;
  if p_duration_minutes is null or p_duration_minutes not between 30 and 180 then
    raise exception 'Duration must be between 30 and 180 minutes';
  end if;
  if exists (select 1 from public.tests where lower(title) = lower(v_title) and id <> p_test_id) then
    raise exception 'A test named "%" already exists', v_title;
  end if;
  perform public.test_check_pools(p_topics);

  update public.tests
  set title = v_title, duration_minutes = p_duration_minutes, updated_by = (select auth.uid())
  where id = p_test_id;

  delete from public.test_topics where test_id = p_test_id;
  insert into public.test_topics (test_id, category_id, sort_order, question_count, hard_count, medium_count, easy_count)
  select p_test_id, t.category_id, t.sort_order, t.question_count, t.hard_count, t.medium_count, t.easy_count
  from public.test_read_topics(p_topics) t;
end;
$$;
revoke all on function public.test_update(uuid, text, integer, jsonb) from public, anon;
grant execute on function public.test_update(uuid, text, integer, jsonb) to authenticated;

-- Archive (keeps it for past results, out of new schedules) or restore.
create function public.test_set_archived(p_test_id uuid, p_archived boolean)
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
  update public.tests
  set archived_at = case when p_archived then coalesce(archived_at, now()) end,
      archived_by = case when p_archived then coalesce(archived_by, (select auth.uid())) end
  where id = p_test_id;
  if not found then
    raise exception 'Test not found';
  end if;
end;
$$;
revoke all on function public.test_set_archived(uuid, boolean) from public, anon;
grant execute on function public.test_set_archived(uuid, boolean) to authenticated;
