-- PrepCode Practice: one optional image per MCQ, shown above the question (e.g. a chart for Data Interpretation).
--
-- The image is uploaded to the public pc-images bucket under questions/ and the question keeps its address. Only our
-- bucket's addresses are accepted, so a question can't load an outside image (which could track who opens it).
-- Both apps show it in the same box: the question panel's full width, at most 320 px tall, scaled to fit, never cropped.
-- image_alt describes it for screen readers and for when it doesn't load; a published question with an image needs one.
-- Coding questions don't take an image yet.

alter table public.pc_questions
  add column image_url text check (
    image_url is null
    or image_url ~ '^https://gjlynpdgovgyyklamtds\.supabase\.co/storage/v1/object/public/pc-images/questions/[0-9a-f-]{36}\.(png|jpg|webp)$'
  ),
  add column image_alt text not null default '' check (length(image_alt) <= 300);

-- Question images (charts, tables) run bigger than card icons. The app keeps its own 200 KB limit for card images.
update storage.buckets set file_size_limit = 512000 where id = 'pc-images';

-- The MCQ checks, plus the image's description.
create or replace function public.pc_mcq_problems(p_question_id uuid)
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
  if q.image_url is not null and btrim(q.image_alt) = '' then
    v_problems := v_problems || 'The image needs a description'::text;
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

-- pc_mcq_save takes the image; nothing called the old signature yet.
drop function public.pc_mcq_save(uuid, uuid, text, text, text, text, text, text, text[], jsonb);

-- Creates (p_question_id null) or replaces an MCQ with its image, hints and options, in one go, and returns its id.
-- New questions start as drafts at the end of their category; moving to another MCQ category puts it last there.
--   p_image_url  a pc-images questions/ address, or null for none. p_image_alt is kept only with an image.
--   p_hints      markdown, in order; empty ones are dropped. At most 4.
--   p_options    [{"id": "<uuid>", "body": "...", "explanation": "...", "is_correct": false}], in order, at most 6.
--                The app makes each id when the option is added; options left out are removed.
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
  p_image_url text,
  p_image_alt text,
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
  v_image_url text := nullif(btrim(coalesce(p_image_url, '')), '');
  v_image_alt text;
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
  if v_image_url is not null
     and v_image_url !~ '^https://gjlynpdgovgyyklamtds\.supabase\.co/storage/v1/object/public/pc-images/questions/[0-9a-f-]{36}\.(png|jpg|webp)$' then
    raise exception 'Upload the image in prepwisely';
  end if;
  v_image_alt := case when v_image_url is null then '' else public.pc_clean_text(p_image_alt) end;
  if length(v_image_alt) > 300 then
    raise exception 'The image description can be at most 300 characters';
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
      image_url = v_image_url,
      image_alt = v_image_alt,
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
revoke all on function public.pc_mcq_save(uuid, uuid, text, text, text, text, text, text, text, text, text[], jsonb) from public, anon;
grant execute on function public.pc_mcq_save(uuid, uuid, text, text, text, text, text, text, text, text, text[], jsonb) to authenticated;
