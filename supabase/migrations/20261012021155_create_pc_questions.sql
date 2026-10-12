-- PrepCode Practice, step 2 (PRACTICE.md §2): coding questions inside the category cards.
--
-- Three new `pc_` tables; no existing table is changed:
--   pc_questions          a question: case study, method signature, Public / Private, draft / published.
--   pc_test_cases         its test cases: inputs and expected value as JSON, Example (shown) or Hidden.
--   pc_question_solutions its reference solutions, at most one per language. Staff only, never sent to PrepCode.
--
-- Rules follow PrepCode's question-structure.md. Writes go through the functions below (tables are read-only to
-- clients), for superadmin and content managers (pc_can_manage) until who writes questions is decided.
--
-- Solutions run on the author's computer (prepwisely checks each one against every case), so the database can't run
-- them itself: the app reports which solutions passed when it saves. A question can be published only when every
-- solution it has passed every case.
--
-- PrepCode reads published Public questions and their Example cases. Private questions show in a category's list
-- (title, difficulty) but their content stays hidden until college subscriptions (step 3). Hidden cases are never
-- readable by students yet (PRACTICE.md §6).

-- ---------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------

create table public.pc_questions (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.pc_categories(id) on delete restrict,
  -- Students' answers are saved as practice/<slug>.<ext>, so it can't change once the question has been published.
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 64),
  title text not null check (btrim(title) <> '' and length(title) <= 80),
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  -- What it practises, e.g. Loops, Strings.
  topic text not null default '' check (length(topic) <= 40),
  -- public: every PrepCode student, guests included. private: students of colleges subscribing to the category.
  access text not null default 'public' check (access in ('public', 'private')),
  status text not null default 'draft' check (status in ('draft', 'published')),
  -- The case study (markdown), without the examples.
  description text not null default '' check (length(description) <= 20000),
  constraints text not null default '' check (length(constraints) <= 1000),
  -- How to solve it; stored now, shown to students later.
  explanation text not null default '' check (length(explanation) <= 20000),
  -- camelCase, e.g. isLeapYear. Empty while a draft is being written.
  method text not null default '' check (method = '' or (method ~ '^[a-z][A-Za-z0-9]*$' and length(method) <= 40)),
  -- Ordered [{"name": "year", "type": "int"}]; may be empty.
  params jsonb not null default '[]' check (jsonb_typeof(params) = 'array'),
  returns text not null default 'int' check (returns in ('int', 'long', 'bool', 'string', 'int[]', 'string[]')),
  -- Order within the category, smallest first.
  position integer not null check (position >= 1),
  -- Set the first time it's published; from then on the slug is fixed.
  first_published_at timestamptz,
  published_at timestamptz,
  created_by uuid not null references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.profiles(id),
  constraint pc_questions_archive_pair check ((archived_by is null) = (archived_at is null)),
  constraint pc_questions_published_at check ((status = 'published') = (published_at is not null)),
  constraint pc_questions_position_key unique (category_id, position) deferrable initially deferred
);

create unique index pc_questions_slug_key on public.pc_questions (slug);
create index pc_questions_created_by_idx on public.pc_questions (created_by);
create index pc_questions_updated_by_idx on public.pc_questions (updated_by);
create index pc_questions_archived_by_idx on public.pc_questions (archived_by);

create trigger pc_questions_set_updated_at
  before update on public.pc_questions
  for each row execute function public.set_updated_at();

create table public.pc_test_cases (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.pc_questions(id) on delete cascade,
  -- Examples are numbered Example 1, 2, 3 in this order.
  position integer not null check (position >= 1),
  -- example: shown to students, checked by Run and Submit. hidden: checked at Submit only.
  visibility text not null check (visibility in ('example', 'hidden')),
  -- One value per parameter, in the method's parameter order: [2024] for isLeapYear(year).
  inputs jsonb not null check (jsonb_typeof(inputs) = 'array'),
  expected jsonb not null,
  -- A short line shown under an example.
  note text not null default '' check (length(note) <= 500),
  constraint pc_test_cases_position_key unique (question_id, position) deferrable initially deferred
);

create table public.pc_question_solutions (
  question_id uuid not null references public.pc_questions(id) on delete cascade,
  language text not null check (language in ('python', 'java', 'cpp', 'c', 'csharp')),
  code text not null check (btrim(code) <> '' and length(code) <= 50000),
  -- When this code last passed every test case (reported by prepwisely when it saves); null = not passing or not run.
  passed_at timestamptz,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (question_id, language)
);

create index pc_question_solutions_updated_by_idx on public.pc_question_solutions (updated_by);

-- ---------------------------------------------------------------------------------------------------------
-- Read access
-- ---------------------------------------------------------------------------------------------------------

alter table public.pc_questions enable row level security;
alter table public.pc_test_cases enable row level security;
alter table public.pc_question_solutions enable row level security;
-- This project auto-grants full privileges on new tables; revoke, then grant read only.
revoke all on public.pc_questions from public, anon, authenticated;
revoke all on public.pc_test_cases from public, anon, authenticated;
revoke all on public.pc_question_solutions from public, anon, authenticated;
grant select on public.pc_questions to anon, authenticated;
grant select on public.pc_test_cases to anon, authenticated;
-- Solutions: signed-in staff only (and the policy narrows it to practice managers).
grant select on public.pc_question_solutions to authenticated;

-- Whether PrepCode shows a question's content: published, Public, not archived, in an active category and domain.
create function public.pc_question_is_open(p_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pc_questions q
    join public.pc_categories c on c.id = q.category_id
    join public.pc_domains d on d.id = c.domain_id
    where q.id = p_question_id
      and q.status = 'published' and q.access = 'public' and q.archived_at is null
      and c.archived_at is null and d.archived_at is null
  );
$$;
revoke all on function public.pc_question_is_open(uuid) from public;
grant execute on function public.pc_question_is_open(uuid) to anon, authenticated;

create policy "open pc questions readable by everyone"
  on public.pc_questions for select to anon, authenticated
  using ((select public.pc_question_is_open(id)));

create policy "example cases of open pc questions readable by everyone"
  on public.pc_test_cases for select to anon, authenticated
  using (visibility = 'example' and (select public.pc_question_is_open(question_id)));

create policy "all pc questions readable by practice managers"
  on public.pc_questions for select to authenticated
  using ((select public.pc_can_manage()));

create policy "all pc test cases readable by practice managers"
  on public.pc_test_cases for select to authenticated
  using ((select public.pc_can_manage()));

create policy "pc solutions readable by practice managers"
  on public.pc_question_solutions for select to authenticated
  using ((select public.pc_can_manage()));

-- A category's question list for PrepCode, Private ones included but locked: no content, just what the list shows.
create function public.pc_category_questions(p_category_slug text)
returns table (id uuid, slug text, title text, difficulty text, topic text, access text, "position" integer)
language sql
stable
security definer
set search_path = ''
as $$
  select q.id, q.slug, q.title, q.difficulty, q.topic, q.access, q.position
  from public.pc_questions q
  join public.pc_categories c on c.id = q.category_id
  join public.pc_domains d on d.id = c.domain_id
  where c.slug = p_category_slug
    and q.status = 'published' and q.archived_at is null
    and c.archived_at is null and d.archived_at is null
  order by q.position;
$$;
revoke all on function public.pc_category_questions(text) from public;
grant execute on function public.pc_category_questions(text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Checks
-- ---------------------------------------------------------------------------------------------------------

-- Why a method or parameter name can't be used (question-structure.md §3.2), or null.
create function public.pc_name_problem(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_name, '') = '' then 'is required'
    when p_name !~ '^[a-z][A-Za-z0-9]*$' then 'must be camelCase, starting with a lowercase letter'
    when p_name = any (array[
      'class', 'new', 'delete', 'default', 'int', 'char', 'string', 'function', 'var', 'return', 'main', 'print', 'len',
      'type', 'func', 'go', 'select', 'range', 'map', 'struct',
      'abs', 'exit', 'printf', 'strlen', 'max', 'min', 'pow', 'sqrt', 'index', 'time', 'free', 'malloc'
    ]) then 'is a keyword or built-in name in one of PrepCode''s languages'
  end;
$$;
revoke all on function public.pc_name_problem(text) from public, anon, authenticated;

-- Why a JSON value isn't a valid `p_type` (question-structure.md §3.5), or null.
create function public.pc_value_problem(p_type text, p_value jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
begin
  case p_type
    when 'int', 'long' then
      if jsonb_typeof(p_value) <> 'number' or (p_value::text)::numeric <> trunc((p_value::text)::numeric) then
        return 'must be a whole number';
      end if;
      if p_type = 'int' and (p_value::text)::numeric not between -2147483648 and 2147483647 then
        return 'is out of int range';
      end if;
      if p_type = 'long' and abs((p_value::text)::numeric) > 9007199254740991 then
        return 'is out of long range (±2⁵³−1)';
      end if;
    when 'bool' then
      if jsonb_typeof(p_value) <> 'boolean' then
        return 'must be true or false';
      end if;
    when 'string' then
      if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') ~ '[\r\n]' then
        return 'must be one line of text';
      end if;
    when 'int[]', 'string[]' then
      if jsonb_typeof(p_value) <> 'array' then
        return 'must be a list';
      end if;
      for v_item in select value from jsonb_array_elements(p_value) loop
        if public.pc_value_problem(left(p_type, -2), v_item) is not null then
          return 'has an item that ' || public.pc_value_problem(left(p_type, -2), v_item);
        end if;
      end loop;
    else
      return 'has an unknown type';
  end case;
  return null;
end;
$$;
revoke all on function public.pc_value_problem(text, jsonb) from public, anon, authenticated;

-- Everything stopping a question from being published; empty when it's ready. Mirrors publishChecks in the app.
create function public.pc_question_problems(p_question_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q public.pc_questions;
  v_problems text[] := '{}';
  v_names text[];
  v_param jsonb;
  v_case public.pc_test_cases;
  v_i integer;
  v_problem text;
begin
  select * into q from public.pc_questions where id = p_question_id;
  if btrim(q.topic) = '' then
    v_problems := v_problems || 'Topic is required'::text;
  end if;
  if array_length(regexp_split_to_array(btrim(q.description), '\s+'), 1) < 100 or btrim(q.description) = '' then
    v_problems := v_problems || 'The case study needs at least 100 words'::text;
  end if;
  if btrim(q.constraints) = '' then
    v_problems := v_problems || 'Constraints are required'::text;
  end if;
  v_problem := public.pc_name_problem(q.method);
  if v_problem is not null then
    v_problems := v_problems || ('The method name ' || v_problem);
  end if;

  select coalesce(array_agg(p ->> 'name'), '{}') into v_names from jsonb_array_elements(q.params) p;
  for v_param in select value from jsonb_array_elements(q.params) loop
    v_problem := public.pc_name_problem(v_param ->> 'name');
    if v_problem is not null then
      v_problems := v_problems || format('Parameter "%s" %s', v_param ->> 'name', v_problem);
    elsif (v_param ->> 'name') ~ '^_?pc' then
      v_problems := v_problems || format('Parameter "%s": names starting with pc are reserved', v_param ->> 'name');
    elsif (v_param ->> 'name') = q.method then
      v_problems := v_problems || format('Parameter "%s" has the same name as the method', v_param ->> 'name');
    elsif (v_param ->> 'type') like '%[]' and (v_param ->> 'name') || 'Size' = any (v_names) then
      v_problems := v_problems || format('Parameter "%sSize" clashes with C''s size parameter for "%s"', v_param ->> 'name', v_param ->> 'name');
    end if;
  end loop;
  if cardinality(v_names) <> (select count(distinct n) from unnest(v_names) n) then
    v_problems := v_problems || 'Two parameters have the same name'::text;
  end if;

  if (select count(*) from public.pc_test_cases where question_id = p_question_id and visibility = 'example') < 3 then
    v_problems := v_problems || 'At least 3 examples are needed'::text;
  end if;
  for v_case in select * from public.pc_test_cases where question_id = p_question_id order by position loop
    if jsonb_array_length(v_case.inputs) <> jsonb_array_length(q.params) then
      v_problems := v_problems || format('Test case %s doesn''t have a value for every parameter', v_case.position);
      continue;
    end if;
    for v_i in 0 .. jsonb_array_length(q.params) - 1 loop
      v_problem := public.pc_value_problem(q.params -> v_i ->> 'type', v_case.inputs -> v_i);
      if v_problem is not null then
        v_problems := v_problems || format('Test case %s: %s %s', v_case.position, q.params -> v_i ->> 'name', v_problem);
      end if;
    end loop;
    v_problem := public.pc_value_problem(q.returns, v_case.expected);
    if v_problem is not null then
      v_problems := v_problems || format('Test case %s: the expected value %s', v_case.position, v_problem);
    end if;
  end loop;

  if not exists (select 1 from public.pc_question_solutions where question_id = p_question_id) then
    v_problems := v_problems || 'At least one solution is needed'::text;
  elsif exists (select 1 from public.pc_question_solutions where question_id = p_question_id and passed_at is null) then
    v_problems := v_problems || 'Every solution must pass every test case. Run them again.'::text;
  end if;
  return v_problems;
end;
$$;
-- Only called inside the functions below; never by clients (it would describe Private questions).
revoke all on function public.pc_question_problems(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Functions the app calls
-- ---------------------------------------------------------------------------------------------------------

-- Creates (p_question_id null) or replaces a question with its test cases and solutions, in one go, and returns its
-- id. New questions start as drafts at the end of their category; moving to another category puts it last there.
--   p_params      [{"name": "year", "type": "int"}]
--   p_test_cases  [{"visibility": "example", "inputs": [2024], "expected": true, "note": ""}], in order
--   p_solutions   [{"language": "python", "code": "...", "passed": true}]; "passed" = the app saw this exact code
--                 pass every one of these cases. Languages left out are removed.
-- Drafts may be incomplete. A published question must still pass every check, or the save is refused.
create function public.pc_question_save(
  p_question_id uuid,
  p_category_id uuid,
  p_slug text,
  p_title text,
  p_difficulty text,
  p_topic text,
  p_access text,
  p_description text,
  p_constraints text,
  p_explanation text,
  p_method text,
  p_params jsonb,
  p_returns text,
  p_test_cases jsonb,
  p_solutions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_title text := public.pc_clean_text(p_title);
  v_current public.pc_questions;
  v_id uuid := p_question_id;
  v_problems text[];
  v_case jsonb;
  v_solution jsonb;
  v_position integer := 0;
begin
  if not public.pc_can_manage() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  v_slug := public.pc_check_slug(p_slug);
  if v_title = '' then
    raise exception 'Title is required';
  end if;
  if length(v_title) > 80 then
    raise exception 'Title can be at most 80 characters';
  end if;
  if coalesce(p_difficulty, '') not in ('easy', 'medium', 'hard') then
    raise exception 'Difficulty must be easy, medium or hard';
  end if;
  if coalesce(p_access, '') not in ('public', 'private') then
    raise exception 'Access must be public or private';
  end if;
  if coalesce(p_returns, '') not in ('int', 'long', 'bool', 'string', 'int[]', 'string[]') then
    raise exception 'Choose a supported return type';
  end if;
  if coalesce(jsonb_typeof(p_params), '') <> 'array'
     or exists (
       select 1 from jsonb_array_elements(p_params) p
       where jsonb_typeof(p) <> 'object'
          or coalesce(p ->> 'type', '') not in ('int', 'long', 'bool', 'string', 'int[]', 'string[]')
     )
  then
    raise exception 'Every parameter needs a name and a supported type';
  end if;
  if coalesce(jsonb_typeof(p_test_cases), '') <> 'array'
     or exists (
       select 1 from jsonb_array_elements(p_test_cases) t
       where coalesce(t ->> 'visibility', '') not in ('example', 'hidden')
          or coalesce(jsonb_typeof(t -> 'inputs'), '') <> 'array'
          or not (t ? 'expected')
     )
  then
    raise exception 'Test cases are malformed';
  end if;
  if coalesce(jsonb_typeof(p_solutions), '') <> 'array'
     or exists (
       select 1 from jsonb_array_elements(p_solutions) s
       where coalesce(s ->> 'language', '') not in ('python', 'java', 'cpp', 'c', 'csharp')
          or btrim(coalesce(s ->> 'code', '')) = ''
     )
     or (select count(*) from jsonb_array_elements(p_solutions)) <>
        (select count(distinct s ->> 'language') from jsonb_array_elements(p_solutions) s)
  then
    raise exception 'Solutions are malformed: one per language, none empty';
  end if;

  -- The category: active, and locked so appends to it can't take the same position.
  perform 1 from public.pc_categories c join public.pc_domains d on d.id = c.domain_id
  where c.id = p_category_id and c.archived_at is null and d.archived_at is null
  for update of c;
  if not found then
    raise exception 'Choose an active category';
  end if;

  if v_id is null then
    if exists (select 1 from public.pc_questions where slug = v_slug) then
      raise exception 'A question with the slug "%" already exists', v_slug;
    end if;
    insert into public.pc_questions (category_id, slug, title, difficulty, position, created_by)
    values (
      p_category_id, v_slug, v_title, p_difficulty,
      coalesce((select max(position) from public.pc_questions where category_id = p_category_id), 0) + 1,
      (select auth.uid())
    )
    returning * into v_current;
    v_id := v_current.id;
  else
    select * into v_current from public.pc_questions where id = v_id for update;
    if not found then
      raise exception 'Question not found';
    end if;
    if v_current.archived_at is not null then
      raise exception 'This question is archived. Restore it before editing.';
    end if;
    if v_current.first_published_at is not null and v_slug <> v_current.slug then
      raise exception 'The slug can''t change after publishing: students'' answers are saved under it';
    end if;
    if exists (select 1 from public.pc_questions where slug = v_slug and id <> v_id) then
      raise exception 'A question with the slug "%" already exists', v_slug;
    end if;
  end if;

  update public.pc_questions
  set category_id = p_category_id,
      slug = v_slug,
      title = v_title,
      difficulty = p_difficulty,
      topic = public.pc_clean_text(p_topic),
      access = p_access,
      description = btrim(coalesce(p_description, '')),
      constraints = btrim(coalesce(p_constraints, '')),
      explanation = btrim(coalesce(p_explanation, '')),
      method = btrim(coalesce(p_method, '')),
      params = p_params,
      returns = p_returns,
      position = case
        when p_category_id = v_current.category_id then position
        else coalesce((select max(x.position) from public.pc_questions x where x.category_id = p_category_id), 0) + 1
      end,
      updated_by = (select auth.uid())
  where id = v_id;

  delete from public.pc_test_cases where question_id = v_id;
  for v_case in select value from jsonb_array_elements(p_test_cases) loop
    v_position := v_position + 1;
    insert into public.pc_test_cases (question_id, position, visibility, inputs, expected, note)
    values (v_id, v_position, v_case ->> 'visibility', v_case -> 'inputs', v_case -> 'expected', btrim(coalesce(v_case ->> 'note', '')));
  end loop;

  delete from public.pc_question_solutions where question_id = v_id;
  for v_solution in select value from jsonb_array_elements(p_solutions) loop
    insert into public.pc_question_solutions (question_id, language, code, passed_at, updated_by)
    values (
      v_id, v_solution ->> 'language', v_solution ->> 'code',
      case when (v_solution ->> 'passed')::boolean then now() end,
      (select auth.uid())
    );
  end loop;

  if v_current.status = 'published' then
    v_problems := public.pc_question_problems(v_id);
    if cardinality(v_problems) > 0 then
      raise exception 'A published question must stay ready to publish: %', array_to_string(v_problems, '; ');
    end if;
  end if;
  return v_id;
end;
$$;
revoke all on function public.pc_question_save(uuid, uuid, text, text, text, text, text, text, text, text, text, jsonb, text, jsonb, jsonb) from public, anon;
grant execute on function public.pc_question_save(uuid, uuid, text, text, text, text, text, text, text, text, text, jsonb, text, jsonb, jsonb) to authenticated;

-- Publishes a draft (refused with the list of problems if it isn't ready), or moves a published question back to
-- draft, which hides it from PrepCode.
create function public.pc_question_set_published(p_question_id uuid, p_published boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.pc_questions;
  v_problems text[];
begin
  if not public.pc_can_manage() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into v_current from public.pc_questions where id = p_question_id for update;
  if not found then
    raise exception 'Question not found';
  end if;
  if v_current.archived_at is not null then
    raise exception 'This question is archived. Restore it first.';
  end if;
  if p_published then
    v_problems := public.pc_question_problems(p_question_id);
    if cardinality(v_problems) > 0 then
      raise exception 'Not ready to publish: %', array_to_string(v_problems, '; ');
    end if;
    update public.pc_questions
    set status = 'published',
        published_at = now(),
        first_published_at = coalesce(first_published_at, now()),
        updated_by = (select auth.uid())
    where id = p_question_id;
  else
    update public.pc_questions
    set status = 'draft', published_at = null, updated_by = (select auth.uid())
    where id = p_question_id;
  end if;
end;
$$;
revoke all on function public.pc_question_set_published(uuid, boolean) from public, anon;
grant execute on function public.pc_question_set_published(uuid, boolean) to authenticated;

-- Archive (hidden from PrepCode) or restore. Restoring brings it back as a draft.
create function public.pc_question_set_archived(p_question_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.pc_can_manage() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_archived is null then
    raise exception 'Say whether to archive or restore';
  end if;
  update public.pc_questions
  set archived_at = case when p_archived then coalesce(archived_at, now()) end,
      archived_by = case when p_archived then coalesce(archived_by, (select auth.uid())) end,
      status = case when p_archived then status else 'draft' end,
      published_at = case when p_archived then published_at end,
      updated_by = (select auth.uid())
  where id = p_question_id;
  if not found then
    raise exception 'Question not found';
  end if;
end;
$$;
revoke all on function public.pc_question_set_archived(uuid, boolean) from public, anon;
grant execute on function public.pc_question_set_archived(uuid, boolean) to authenticated;

-- Sets the order of every question in a category (drafts and archived ones included): the first id is shown first.
create function public.pc_questions_reorder(p_category_id uuid, p_question_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.pc_can_manage() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform 1 from public.pc_categories where id = p_category_id for update;
  if not found then
    raise exception 'Category not found';
  end if;
  if p_question_ids is null
     or array_position(p_question_ids, null) is not null
     or (select count(distinct x) from unnest(p_question_ids) x) <> cardinality(p_question_ids)
     or cardinality(p_question_ids) <> (select count(*) from public.pc_questions where category_id = p_category_id)
     or exists (
       select 1 from unnest(p_question_ids) x
       where not exists (select 1 from public.pc_questions q where q.id = x and q.category_id = p_category_id)
     )
  then
    raise exception 'The question list has changed. Refresh and try again.';
  end if;

  update public.pc_questions q
  set position = x.position::integer
  from unnest(p_question_ids) with ordinality as x(id, position)
  where q.id = x.id and q.position <> x.position::integer;
end;
$$;
revoke all on function public.pc_questions_reorder(uuid, uuid[]) from public, anon;
grant execute on function public.pc_questions_reorder(uuid, uuid[]) to authenticated;
