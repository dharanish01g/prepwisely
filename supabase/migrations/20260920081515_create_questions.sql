-- MCQ question bank: questions, their options (with per-option explanations) and the review trail.
-- Lifecycle: draft -> submitted -> approved | changes_requested | rejected; creators fix and resubmit.
-- Editing an approved question makes it `unverified` (out of tests until re-reviewed).
-- Archiving is a separate flag (not a status) so unarchiving restores the exact prior state.
-- Nothing is ever deleted (options of an editable question excepted).
-- Text fields (description, option body, explanation, review comment) are markdown.

-- True when the calling user holds the given role and their account is active.
create function public.has_role(p_role_id text)
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
      and ur.role_id = p_role_id
      and p.status = 'active'
  );
$$;

revoke execute on function public.has_role(text) from public, anon;
grant execute on function public.has_role(text) to authenticated;

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (btrim(title) <> ''),
  description text not null default '',
  category_id uuid references public.categories (id) on delete restrict,
  difficulty text check (difficulty in ('easy', 'medium', 'hard')),
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'changes_requested', 'rejected', 'unverified')),
  created_by uuid not null references public.profiles (id) on delete restrict,
  submitted_at timestamptz,
  -- Latest review decision. Cleared when an approved question is edited; full history is in question_reviews.
  reviewed_by uuid references public.profiles (id) on delete restrict,
  reviewed_at timestamptz,
  archived_by uuid references public.profiles (id) on delete restrict,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint questions_archive_pair check ((archived_by is null) = (archived_at is null)),
  constraint questions_review_pair check ((reviewed_by is null) = (reviewed_at is null))
);

create index questions_created_by_idx on public.questions (created_by);
create index questions_category_id_idx on public.questions (category_id);
create index questions_status_idx on public.questions (status);
create index questions_reviewed_by_idx on public.questions (reviewed_by);
create index questions_archived_by_idx on public.questions (archived_by);

create trigger questions_set_updated_at
  before update on public.questions
  for each row execute function public.set_updated_at();

-- One row per option. Exactly one must be correct, enforced when the question is submitted/approved
-- (drafts may be incomplete, and swapping the correct option takes two row updates).
create table public.question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions (id) on delete restrict,
  position int not null check (position >= 1),
  body text not null default '',
  explanation text not null default '',
  is_correct boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Deferred so options can be reordered/swapped without tripping over each other mid-statement.
  constraint question_options_position_key unique (question_id, position) deferrable initially deferred
);

create trigger question_options_set_updated_at
  before update on public.question_options
  for each row execute function public.set_updated_at();

-- Append-only history of review decisions.
create table public.question_reviews (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions (id) on delete restrict,
  reviewer_id uuid not null references public.profiles (id) on delete restrict,
  decision text not null check (decision in ('approved', 'changes_requested', 'rejected')),
  comment text,
  created_at timestamptz not null default now(),
  constraint question_reviews_comment_required
    check (decision = 'approved' or btrim(coalesce(comment, '')) <> '')
);

create index question_reviews_question_id_idx on public.question_reviews (question_id, created_at);
create index question_reviews_reviewer_id_idx on public.question_reviews (reviewer_id);

create function public.prevent_review_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Review history is append-only';
end;
$$;

create trigger question_reviews_append_only
  before update or delete on public.question_reviews
  for each row execute function public.prevent_review_change();

-- Editing the content of an approved question sends it back for review.
create function public.questions_unverify_on_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'approved'
     and (new.title, new.description, new.category_id, new.difficulty)
         is distinct from (old.title, old.description, old.category_id, old.difficulty) then
    new.status = 'unverified';
    new.reviewed_by = null;
    new.reviewed_at = null;
  end if;
  return new;
end;
$$;

create trigger questions_unverify_on_edit
  before update on public.questions
  for each row execute function public.questions_unverify_on_edit();

-- Same rule when an option of an approved question is added, changed or removed.
create function public.question_options_unverify_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.questions
  set status = 'unverified', reviewed_by = null, reviewed_at = null
  where id = coalesce(new.question_id, old.question_id)
    and status = 'approved';
  return null;
end;
$$;

revoke execute on function public.question_options_unverify_parent() from public, anon, authenticated;

create trigger question_options_unverify_parent
  after insert or update or delete on public.question_options
  for each row execute function public.question_options_unverify_parent();

-- ---------------------------------------------------------------------------------------------
-- Access control. Clients may only touch content columns; status, review and archive fields change
-- exclusively through the functions below.
-- ---------------------------------------------------------------------------------------------

alter table public.questions enable row level security;
alter table public.question_options enable row level security;
alter table public.question_reviews enable row level security;

revoke all on public.questions, public.question_options, public.question_reviews from anon, authenticated;
grant select on public.questions, public.question_options, public.question_reviews to authenticated;
grant insert (title, description, category_id, difficulty, created_by) on public.questions to authenticated;
grant update (title, description, category_id, difficulty) on public.questions to authenticated;
grant insert, update, delete on public.question_options to authenticated;

-- Creators see their own questions; managers and reviewers see everything except other people's
-- drafts; superadmins see all. Students, faculty, tpo and support get nothing (no policy = no access).
create policy "questions readable by owner, content staff and superadmin"
  on public.questions for select
  to authenticated
  using (
    created_by = (select auth.uid())
    or (select public.is_superadmin())
    or (status <> 'draft' and ((select public.has_role('content_manager')) or (select public.has_role('content_reviewer'))))
  );

create policy "content creators insert own questions"
  on public.questions for insert
  to authenticated
  with check (created_by = (select auth.uid()) and (select public.has_role('content_creator')));

-- A creator can edit their own question except while it is under review or archived.
create policy "creators edit own unlocked questions"
  on public.questions for update
  to authenticated
  using (
    created_by = (select auth.uid())
    and archived_at is null
    and status in ('draft', 'changes_requested', 'rejected', 'unverified', 'approved')
    and (select public.has_role('content_creator'))
  )
  with check (
    created_by = (select auth.uid())
    and status in ('draft', 'changes_requested', 'rejected', 'unverified', 'approved')
  );

-- Options are visible wherever their question is, and editable under the same rules as the question.
create policy "options readable with their question"
  on public.question_options for select
  to authenticated
  using (exists (select 1 from public.questions q where q.id = question_id));

create policy "creators insert options on own unlocked questions"
  on public.question_options for insert
  to authenticated
  with check (exists (
    select 1 from public.questions q
    where q.id = question_id
      and q.created_by = (select auth.uid())
      and q.archived_at is null
      and q.status in ('draft', 'changes_requested', 'rejected', 'unverified', 'approved')
      and (select public.has_role('content_creator'))
  ));

create policy "creators update options on own unlocked questions"
  on public.question_options for update
  to authenticated
  using (exists (
    select 1 from public.questions q
    where q.id = question_id
      and q.created_by = (select auth.uid())
      and q.archived_at is null
      and q.status in ('draft', 'changes_requested', 'rejected', 'unverified', 'approved')
      and (select public.has_role('content_creator'))
  ))
  with check (exists (
    select 1 from public.questions q
    where q.id = question_id and q.created_by = (select auth.uid())
  ));

create policy "creators delete options on own unlocked questions"
  on public.question_options for delete
  to authenticated
  using (exists (
    select 1 from public.questions q
    where q.id = question_id
      and q.created_by = (select auth.uid())
      and q.archived_at is null
      and q.status in ('draft', 'changes_requested', 'rejected', 'unverified', 'approved')
      and (select public.has_role('content_creator'))
  ));

create policy "reviews readable with their question"
  on public.question_reviews for select
  to authenticated
  using (exists (select 1 from public.questions q where q.id = question_id));

-- ---------------------------------------------------------------------------------------------
-- Transitions
-- ---------------------------------------------------------------------------------------------

-- Raises if the question isn't ready to be reviewed or used.
create function public.assert_question_complete(p_question_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  q public.questions;
  v_options int;
  v_correct int;
  v_blank int;
begin
  select * into q from public.questions where id = p_question_id;
  if btrim(q.description) = '' then
    raise exception 'The description is required';
  end if;
  if q.category_id is null then
    raise exception 'A category is required';
  end if;
  if not exists (select 1 from public.categories where id = q.category_id and is_active) then
    raise exception 'The category is inactive';
  end if;
  if q.difficulty is null then
    raise exception 'A difficulty is required';
  end if;

  select count(*),
         count(*) filter (where is_correct),
         count(*) filter (where btrim(body) = '' or btrim(explanation) = '')
  into v_options, v_correct, v_blank
  from public.question_options
  where question_id = p_question_id;

  if v_options < 2 then
    raise exception 'A question needs at least 2 options';
  end if;
  if v_correct <> 1 then
    raise exception 'Exactly one option must be marked correct';
  end if;
  if v_blank > 0 then
    raise exception 'Every option needs text and an explanation';
  end if;
end;
$$;

revoke execute on function public.assert_question_complete(uuid) from public, anon, authenticated;

-- Creator sends a draft (or a fixed rejected/changes_requested/unverified question) for review.
create function public.submit_question(p_question_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.questions;
begin
  select * into q from public.questions where id = p_question_id for update;
  if not found or q.created_by is distinct from (select auth.uid()) or not public.has_role('content_creator') then
    raise exception 'Question not found' using errcode = '42501';
  end if;
  if q.archived_at is not null then
    raise exception 'An archived question cannot be submitted';
  end if;
  if q.status not in ('draft', 'changes_requested', 'rejected', 'unverified') then
    raise exception 'A question with status "%" cannot be submitted', q.status;
  end if;

  perform public.assert_question_complete(p_question_id);

  update public.questions
  set status = 'submitted', submitted_at = now(), reviewed_by = null, reviewed_at = null
  where id = p_question_id;
end;
$$;

-- Reviewer records a decision on a submitted question. Reviewers can't review their own questions.
create function public.review_question(p_question_id uuid, p_decision text, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.questions;
  v_uid uuid := (select auth.uid());
begin
  if not public.has_role('content_reviewer') then
    raise exception 'Only content reviewers can review questions' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'changes_requested', 'rejected') then
    raise exception 'Unknown decision "%"', p_decision;
  end if;

  select * into q from public.questions where id = p_question_id for update;
  if not found or q.status = 'draft' then
    raise exception 'Question not found' using errcode = '42501';
  end if;
  if q.created_by = v_uid then
    raise exception 'You cannot review your own question' using errcode = '42501';
  end if;
  if q.archived_at is not null or q.status <> 'submitted' then
    raise exception 'Only a submitted question can be reviewed';
  end if;
  if p_decision <> 'approved' and btrim(coalesce(p_comment, '')) = '' then
    raise exception 'A comment is required when requesting changes or rejecting';
  end if;

  if p_decision = 'approved' then
    perform public.assert_question_complete(p_question_id);
  end if;

  insert into public.question_reviews (question_id, reviewer_id, decision, comment)
  values (p_question_id, v_uid, p_decision, nullif(btrim(coalesce(p_comment, '')), ''));

  update public.questions
  set status = p_decision, reviewed_by = v_uid, reviewed_at = now()
  where id = p_question_id;
end;
$$;

-- Content manager (or superadmin) archives or restores a question. Archived questions stay in the
-- database but are excluded from tests and locked from edits.
create function public.set_question_archived(p_question_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if not (public.has_role('content_manager') or public.is_superadmin()) then
    raise exception 'Only the content manager can archive questions' using errcode = '42501';
  end if;

  update public.questions
  set archived_by = case when p_archived then v_uid end,
      archived_at = case when p_archived then now() end
  where id = p_question_id;
  if not found then
    raise exception 'Question not found';
  end if;
end;
$$;

revoke execute on function public.submit_question(uuid) from public, anon;
revoke execute on function public.review_question(uuid, text, text) from public, anon;
revoke execute on function public.set_question_archived(uuid, boolean) from public, anon;
grant execute on function public.submit_question(uuid) to authenticated;
grant execute on function public.review_question(uuid, text, text) to authenticated;
grant execute on function public.set_question_archived(uuid, boolean) to authenticated;
