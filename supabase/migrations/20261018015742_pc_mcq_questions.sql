-- PrepCode Practice: MCQ questions in MCQ cards (practice-mcq.md; PrepCode's "MCQ data structure for backend").
--
-- An MCQ is a pc_questions row in an MCQ category. Its kind comes from the category (no column of its own): a card's
-- kind is fixed once it has questions, and a question can only move to a card of the same kind. An MCQ uses the
-- shared fields (title, slug, difficulty, topic, access, status, position) with `description` as the question, plus:
--   hints                ordered markdown nudges, 1 to 4, each a little stronger and never the answer;
--   pc_question_options  4 to 6 options, exactly one correct, each with its own explanation.
-- The coding fields (constraints, explanation, method, params, returns) stay empty. Everything is markdown, no images
-- or LaTeX yet.
--
-- PrepCode reads an open MCQ with all its options, is_correct and explanations included, so feedback on a pick is
-- instant. Accepted for Practice: its MCQs are written for Practice and never used in tests (practice-mcq.md §5.1).
-- Option ids stay the same across saves, because PrepCode records picks against them.

-- ---------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------

alter table public.pc_questions
  add column hints text[] not null default '{}' check (cardinality(hints) <= 4);

-- MCQs have no return type.
alter table public.pc_questions drop constraint pc_questions_returns_check;
alter table public.pc_questions
  add constraint pc_questions_returns_check check (returns in ('', 'int', 'long', 'bool', 'string', 'int[]', 'string[]'));

create table public.pc_question_options (
  -- Made by prepwisely when the option is added, and kept: PrepCode records picks against it.
  id uuid primary key,
  question_id uuid not null references public.pc_questions(id) on delete cascade,
  -- The author's order; PrepCode shuffles for display.
  position integer not null check (position >= 1),
  -- Drafts may leave these empty; publishing needs both.
  body text not null default '' check (length(body) <= 1000),
  -- Why this option is right or wrong.
  explanation text not null default '' check (length(explanation) <= 2000),
  is_correct boolean not null default false,
  constraint pc_question_options_position_key unique (question_id, position) deferrable initially deferred
);

create index pc_question_options_question_id_idx on public.pc_question_options (question_id);
-- At most one correct option, even in a draft; publishing needs exactly one.
create unique index pc_question_options_one_correct on public.pc_question_options (question_id) where is_correct;

alter table public.pc_question_options enable row level security;
-- This project auto-grants full privileges on new tables; revoke, then grant read only. Writes go through pc_mcq_save.
revoke all on public.pc_question_options from public, anon, authenticated;
grant select on public.pc_question_options to anon, authenticated;

create policy "options of open pc questions readable by everyone"
  on public.pc_question_options for select to anon, authenticated
  using ((select public.pc_question_is_open(question_id)));

create policy "all pc question options readable by practice managers"
  on public.pc_question_options for select to authenticated
  using ((select public.pc_can_manage()));

-- ---------------------------------------------------------------------------------------------------------
-- A question sits in a card of a kind with an editor, and keeps its kind
-- ---------------------------------------------------------------------------------------------------------

create or replace function public.pc_questions_check_kind()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := (select question_kind from public.pc_categories where id = new.category_id);
begin
  if v_kind is null or v_kind not in ('coding', 'mcq') then
    raise exception 'Questions of this category''s kind can''t be written yet';
  end if;
  if tg_op = 'UPDATE' and new.category_id <> old.category_id
     and v_kind is distinct from (select question_kind from public.pc_categories where id = old.category_id) then
    raise exception 'A question can only move to a category of the same kind';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Checks before publishing, by kind
-- ---------------------------------------------------------------------------------------------------------

-- The coding checks keep their body under a new name; pc_question_problems now picks by kind.
alter function public.pc_question_problems(uuid) rename to pc_coding_problems;

-- Everything stopping an MCQ from being published; empty when it's ready. Mirrors the MCQ editor's checks.
create function public.pc_mcq_problems(p_question_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q public.pc_questions;
  v_problems text[] := '{}';
  v_options integer;
begin
  select * into q from public.pc_questions where id = p_question_id;
  if btrim(q.topic) = '' then
    v_problems := v_problems || 'Topic is required'::text;
  end if;
  if btrim(q.description) = '' then
    v_problems := v_problems || 'The question is required'::text;
  end if;
  select count(*) into v_options from public.pc_question_options where question_id = p_question_id;
  if v_options < 4 then
    v_problems := v_problems || 'At least 4 options are needed'::text;
  elsif v_options > 6 then
    v_problems := v_problems || 'At most 6 options'::text;
  end if;
  if (select count(*) from public.pc_question_options where question_id = p_question_id and is_correct) <> 1 then
    v_problems := v_problems || 'Mark exactly one option as correct'::text;
  end if;
  if exists (
    select 1 from public.pc_question_options
    where question_id = p_question_id and (btrim(body) = '' or btrim(explanation) = '')
  ) then
    v_problems := v_problems || 'Every option needs its text and an explanation'::text;
  end if;
  if cardinality(q.hints) < 1 then
    v_problems := v_problems || 'At least 1 hint is needed'::text;
  end if;
  return v_problems;
end;
$$;
revoke all on function public.pc_mcq_problems(uuid) from public, anon, authenticated;

create function public.pc_question_problems(p_question_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case c.question_kind
    when 'mcq' then public.pc_mcq_problems(q.id)
    else public.pc_coding_problems(q.id)
  end
  from public.pc_questions q
  join public.pc_categories c on c.id = q.category_id
  where q.id = p_question_id;
$$;
-- Only called inside the save and publish functions; never by clients (it would describe Private questions).
revoke all on function public.pc_question_problems(uuid) from public, anon, authenticated;
revoke all on function public.pc_coding_problems(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Saving: the coding save refuses MCQ cards; MCQs have their own
-- ---------------------------------------------------------------------------------------------------------

-- The coding save keeps its body under a new name, called only through the guard below.
alter function public.pc_question_save(uuid, uuid, text, text, text, text, text, text, text, text, text, jsonb, text, jsonb, jsonb)
  rename to pc_coding_question_save;
revoke all on function public.pc_coding_question_save(uuid, uuid, text, text, text, text, text, text, text, text, text, jsonb, text, jsonb, jsonb)
  from public, anon, authenticated;

-- Same arguments as before (the editor, import and AI drafts call it): saves a coding question in a coding card.
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
begin
  if not public.pc_can_manage() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if (select question_kind from public.pc_categories where id = p_category_id) is distinct from 'coding' then
    raise exception 'This category isn''t for coding questions';
  end if;
  return public.pc_coding_question_save(
    p_question_id, p_category_id, p_slug, p_title, p_difficulty, p_topic, p_access, p_description, p_constraints,
    p_explanation, p_method, p_params, p_returns, p_test_cases, p_solutions
  );
end;
$$;
revoke all on function public.pc_question_save(uuid, uuid, text, text, text, text, text, text, text, text, text, jsonb, text, jsonb, jsonb) from public, anon;
grant execute on function public.pc_question_save(uuid, uuid, text, text, text, text, text, text, text, text, text, jsonb, text, jsonb, jsonb) to authenticated;

-- Creates (p_question_id null) or replaces an MCQ with its hints and options, in one go, and returns its id. New
-- questions start as drafts at the end of their category; moving to another MCQ category puts it last there.
--   p_hints    markdown, in order; empty ones are dropped. At most 4.
--   p_options  [{"id": "<uuid>", "body": "...", "explanation": "...", "is_correct": false}], in order, at most 6.
--              The app makes each id when the option is added; options left out are removed.
-- Drafts may be incomplete. A published question must still pass every check, or the save is refused.
create function public.pc_mcq_save(
  p_question_id uuid,
  p_category_id uuid,
  p_slug text,
  p_title text,
  p_difficulty text,
  p_topic text,
  p_access text,
  p_description text,
  p_hints text[],
  p_options jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_title text := public.pc_clean_text(p_title);
  v_hints text[];
  v_current public.pc_questions;
  v_id uuid := p_question_id;
  v_problems text[];
  v_option jsonb;
  v_position bigint;
  v_rows integer;
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
  if length(btrim(coalesce(p_description, ''))) > 20000 then
    raise exception 'The question can be at most 20,000 characters';
  end if;

  v_hints := array(
    select btrim(h) from unnest(coalesce(p_hints, '{}')) with ordinality as x(h, i)
    where btrim(coalesce(h, '')) <> '' order by i
  );
  if cardinality(v_hints) > 4 then
    raise exception 'At most 4 hints';
  end if;
  if exists (select 1 from unnest(v_hints) h where length(h) > 2000) then
    raise exception 'A hint can be at most 2,000 characters';
  end if;

  if coalesce(jsonb_typeof(p_options), '') <> 'array'
     or exists (
       select 1 from jsonb_array_elements(p_options) o
       where jsonb_typeof(o) <> 'object'
          or coalesce(o ->> 'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          or coalesce(jsonb_typeof(o -> 'body'), '') <> 'string'
          or coalesce(jsonb_typeof(o -> 'explanation'), '') <> 'string'
          or coalesce(jsonb_typeof(o -> 'is_correct'), '') <> 'boolean'
     )
     or (select count(*) from jsonb_array_elements(p_options)) <>
        (select count(distinct o ->> 'id') from jsonb_array_elements(p_options) o)
  then
    raise exception 'Options are malformed';
  end if;
  if jsonb_array_length(p_options) > 6 then
    raise exception 'At most 6 options';
  end if;
  if (select count(*) from jsonb_array_elements(p_options) o where (o ->> 'is_correct')::boolean) > 1 then
    raise exception 'Only one option can be correct';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_options) o
    where length(btrim(o ->> 'body')) > 1000 or length(btrim(o ->> 'explanation')) > 2000
  ) then
    raise exception 'An option can be at most 1,000 characters, and its explanation at most 2,000';
  end if;

  -- The category: active, for MCQs, and locked so appends to it can't take the same position.
  perform 1 from public.pc_categories c join public.pc_domains d on d.id = c.domain_id
  where c.id = p_category_id and c.archived_at is null and d.archived_at is null
  for update of c;
  if not found then
    raise exception 'Choose an active category';
  end if;
  if (select question_kind from public.pc_categories where id = p_category_id) <> 'mcq' then
    raise exception 'This category isn''t for MCQs';
  end if;

  if v_id is null then
    if exists (select 1 from public.pc_questions where slug = v_slug) then
      raise exception 'A question with the slug "%" already exists', v_slug;
    end if;
    insert into public.pc_questions (category_id, slug, title, difficulty, returns, position, created_by)
    values (
      p_category_id, v_slug, v_title, p_difficulty, '',
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
      raise exception 'The slug can''t change after publishing';
    end if;
    if exists (select 1 from public.pc_questions where slug = v_slug and id <> v_id) then
      raise exception 'A question with the slug "%" already exists', v_slug;
    end if;
  end if;

  -- Moving a coding question here is refused by pc_questions_check_kind.
  update public.pc_questions
  set category_id = p_category_id,
      slug = v_slug,
      title = v_title,
      difficulty = p_difficulty,
      topic = public.pc_clean_text(p_topic),
      access = p_access,
      description = btrim(coalesce(p_description, '')),
      hints = v_hints,
      constraints = '',
      explanation = '',
      method = '',
      params = '[]',
      returns = '',
      position = case
        when p_category_id = v_current.category_id then position
        else coalesce((select max(x.position) from public.pc_questions x where x.category_id = p_category_id), 0) + 1
      end,
      updated_by = (select auth.uid())
  where id = v_id;

  -- Options keep their ids. Clear the correct mark first so moving it between options never has two at once.
  delete from public.pc_question_options
  where question_id = v_id
    and id <> all (array(select (o ->> 'id')::uuid from jsonb_array_elements(p_options) o));
  update public.pc_question_options set is_correct = false where question_id = v_id and is_correct;
  for v_option, v_position in select value, ordinality from jsonb_array_elements(p_options) with ordinality loop
    insert into public.pc_question_options as po (id, question_id, position, body, explanation, is_correct)
    values (
      (v_option ->> 'id')::uuid, v_id, v_position, btrim(v_option ->> 'body'), btrim(v_option ->> 'explanation'),
      (v_option ->> 'is_correct')::boolean
    )
    on conflict (id) do update
      set position = excluded.position, body = excluded.body, explanation = excluded.explanation,
          is_correct = excluded.is_correct
      where po.question_id = v_id;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'Options are malformed: an option id belongs to another question';
    end if;
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
revoke all on function public.pc_mcq_save(uuid, uuid, text, text, text, text, text, text, text[], jsonb) from public, anon;
grant execute on function public.pc_mcq_save(uuid, uuid, text, text, text, text, text, text, text[], jsonb) to authenticated;
