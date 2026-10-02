-- Owner's rule (2026-09-29): every topic in a test has at least 25 questions (still at most 100), so each topic
-- always gets a real 50/30/20 mix (25 -> 13 hard / 7 medium / 5 easy).
-- The constraint is NOT VALID: it holds for every new or changed row, and skips the handful of archived test rows
-- created while checking the first version (they had 1 question per topic and can't be edited while archived).

alter table public.test_topics drop constraint test_topics_question_count_check;
alter table public.test_topics
  add constraint test_topics_question_count_check check (question_count between 25 and 100) not valid;

create or replace function public.test_read_topics(p_topics jsonb)
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
    if v_count is null or v_count < 25 or v_count > 100 then
      raise exception '% needs between 25 and 100 questions', public.category_label(v_id);
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
