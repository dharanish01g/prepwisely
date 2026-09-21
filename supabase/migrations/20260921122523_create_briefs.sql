-- Briefs & targets: the content manager tells creators what to write (a category, how many of each difficulty,
-- optionally a deadline) and assigns creators. Progress counts approved, non-archived questions and is shared
-- across the assigned creators. Linking a question to a brief is optional.

-- True when p_category is p_root or one of its descendants.
create function public.category_within(p_category uuid, p_root uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  with recursive up as (
    select id, parent_id from public.categories where id = p_category
    union all
    select c.id, c.parent_id from public.categories c join up on c.id = up.parent_id
  )
  select exists (select 1 from up where id = p_root);
$$;

revoke execute on function public.category_within(uuid, uuid) from public, anon;
grant execute on function public.category_within(uuid, uuid) to authenticated;

create table public.briefs (
  id uuid primary key default gen_random_uuid(),
  title text not null check (btrim(title) <> ''),
  description text not null default '',
  category_id uuid not null references public.categories (id) on delete restrict,
  target_easy int not null default 0 check (target_easy >= 0),
  target_medium int not null default 0 check (target_medium >= 0),
  target_hard int not null default 0 check (target_hard >= 0),
  deadline date,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid not null references public.profiles (id) on delete restrict,
  closed_by uuid references public.profiles (id) on delete restrict,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint briefs_has_target check (target_easy + target_medium + target_hard > 0)
);

create index briefs_category_id_idx on public.briefs (category_id);
create index briefs_created_by_idx on public.briefs (created_by);
create index briefs_closed_by_idx on public.briefs (closed_by);
create index briefs_status_idx on public.briefs (status);

create trigger briefs_set_updated_at
  before update on public.briefs
  for each row execute function public.set_updated_at();

-- Records who closed a brief; clients can't write those columns.
create function public.briefs_track_close()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'closed' and old.status <> 'closed' then
    new.closed_at = now();
    new.closed_by = (select auth.uid());
  elsif new.status = 'open' and old.status = 'closed' then
    new.closed_at = null;
    new.closed_by = null;
  end if;

  -- Questions are linked by category, so the category is fixed once anything is linked.
  if new.category_id is distinct from old.category_id
     and exists (select 1 from public.questions where brief_id = old.id) then
    raise exception 'The category can''t change once questions are linked to this brief';
  end if;
  return new;
end;
$$;

-- questions.brief_id is added below; this trigger is created after that column exists.

create table public.brief_assignments (
  brief_id uuid not null references public.briefs (id) on delete restrict,
  creator_id uuid not null references public.profiles (id) on delete restrict,
  assigned_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (brief_id, creator_id)
);

create index brief_assignments_creator_id_idx on public.brief_assignments (creator_id);
create index brief_assignments_assigned_by_idx on public.brief_assignments (assigned_by);

-- Only active content creators can be assigned.
create function public.brief_assignments_check_creator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = new.creator_id and ur.role_id = 'content_creator' and p.status = 'active'
  ) then
    raise exception 'Only active content creators can be assigned to a brief';
  end if;
  return new;
end;
$$;

revoke execute on function public.brief_assignments_check_creator() from public, anon, authenticated;

create trigger brief_assignments_check_creator
  before insert on public.brief_assignments
  for each row execute function public.brief_assignments_check_creator();

alter table public.questions add column brief_id uuid references public.briefs (id) on delete restrict;
create index questions_brief_id_idx on public.questions (brief_id);

create trigger briefs_track_close
  before update on public.briefs
  for each row execute function public.briefs_track_close();

-- A question can only be linked to an open brief its creator is assigned to, and must sit inside the brief's category.
create function public.questions_check_brief()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brief public.briefs;
begin
  if new.brief_id is null then
    return new;
  end if;

  select * into v_brief from public.briefs where id = new.brief_id;

  if tg_op = 'INSERT' or new.brief_id is distinct from old.brief_id then
    if not exists (select 1 from public.brief_assignments where brief_id = new.brief_id and creator_id = new.created_by) then
      raise exception 'You are not assigned to this brief';
    end if;
    if v_brief.status <> 'open' then
      raise exception 'This brief is closed';
    end if;
  end if;

  if new.category_id is not null and not public.category_within(new.category_id, v_brief.category_id) then
    raise exception 'The category must be inside the brief''s category';
  end if;
  return new;
end;
$$;

revoke execute on function public.questions_check_brief() from public, anon, authenticated;

create trigger questions_check_brief
  before insert or update of brief_id, category_id on public.questions
  for each row execute function public.questions_check_brief();

-- Submitting/approving also re-checks the brief's category (a draft may not have one yet).
create or replace function public.assert_question_complete(p_question_id uuid)
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
  if q.brief_id is not null
     and not public.category_within(q.category_id, (select category_id from public.briefs where id = q.brief_id)) then
    raise exception 'The category must be inside the brief''s category';
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

-- ---------------------------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------------------------

alter table public.briefs enable row level security;
alter table public.brief_assignments enable row level security;

revoke all on public.briefs, public.brief_assignments from anon, authenticated;
grant select on public.briefs, public.brief_assignments to authenticated;
grant insert (title, description, category_id, target_easy, target_medium, target_hard, deadline, created_by) on public.briefs to authenticated;
grant update (title, description, category_id, target_easy, target_medium, target_hard, deadline, status) on public.briefs to authenticated;
grant insert (brief_id, creator_id, assigned_by) on public.brief_assignments to authenticated;
grant delete on public.brief_assignments to authenticated;
-- The creator sets a question's brief from the editor.
grant insert (brief_id) on public.questions to authenticated;
grant update (brief_id) on public.questions to authenticated;

create policy "briefs readable by managers, superadmin and assigned creators"
  on public.briefs for select
  to authenticated
  using (
    (select public.is_superadmin())
    or (select public.has_role('content_manager'))
    or exists (select 1 from public.brief_assignments a where a.brief_id = briefs.id and a.creator_id = (select auth.uid()))
  );

create policy "managers create briefs"
  on public.briefs for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and ((select public.is_superadmin()) or (select public.has_role('content_manager')))
  );

create policy "managers edit briefs"
  on public.briefs for update
  to authenticated
  using ((select public.is_superadmin()) or (select public.has_role('content_manager')))
  with check ((select public.is_superadmin()) or (select public.has_role('content_manager')));

create policy "assignments readable by managers, superadmin and the creator"
  on public.brief_assignments for select
  to authenticated
  using (
    creator_id = (select auth.uid())
    or (select public.is_superadmin())
    or (select public.has_role('content_manager'))
  );

create policy "managers assign creators"
  on public.brief_assignments for insert
  to authenticated
  with check (
    assigned_by = (select auth.uid())
    and ((select public.is_superadmin()) or (select public.has_role('content_manager')))
  );

create policy "managers unassign creators"
  on public.brief_assignments for delete
  to authenticated
  using ((select public.is_superadmin()) or (select public.has_role('content_manager')));

-- The content manager needs to see the content team (names, roles) to assign work and, later, manage it.
create policy "content manager reads content team roles"
  on public.user_roles for select
  to authenticated
  using ((select public.has_role('content_manager')) and role_id in ('content_creator', 'content_reviewer', 'content_manager'));

create policy "content manager reads content team profiles"
  on public.profiles for select
  to authenticated
  using (
    (select public.has_role('content_manager'))
    and exists (
      select 1 from public.user_roles ur
      where ur.user_id = profiles.id and ur.role_id in ('content_creator', 'content_reviewer', 'content_manager')
    )
  );

-- ---------------------------------------------------------------------------------------------
-- Progress. Definer functions so an assigned creator can see the shared totals without being able to
-- read other creators' questions; both return counts only.
-- ---------------------------------------------------------------------------------------------

-- Delivered (approved, not archived) and in-review counts per brief and difficulty, for the briefs the caller can see.
create function public.brief_progress(p_brief_ids uuid[] default null)
returns table (brief_id uuid, difficulty text, approved int, in_review int)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id,
         d.difficulty,
         (count(q.id) filter (where q.status = 'approved' and q.archived_at is null))::int,
         (count(q.id) filter (where q.status = 'submitted' and q.archived_at is null))::int
  from public.briefs b
  cross join (values ('easy'), ('medium'), ('hard')) as d (difficulty)
  left join public.questions q on q.brief_id = b.id and q.difficulty = d.difficulty
  where (p_brief_ids is null or b.id = any (p_brief_ids))
    and (
      public.is_superadmin()
      or public.has_role('content_manager')
      or exists (select 1 from public.brief_assignments a where a.brief_id = b.id and a.creator_id = (select auth.uid()))
    )
  group by b.id, d.difficulty;
$$;

-- Each creator's contribution to one brief (managers and superadmin only).
create function public.brief_contributions(p_brief_id uuid)
returns table (creator_id uuid, approved int, in_review int)
language sql
stable
security definer
set search_path = ''
as $$
  select c.creator_id,
         (count(q.id) filter (where q.status = 'approved' and q.archived_at is null))::int,
         (count(q.id) filter (where q.status = 'submitted' and q.archived_at is null))::int
  from (
    select a.creator_id from public.brief_assignments a where a.brief_id = p_brief_id
    union
    select q2.created_by from public.questions q2 where q2.brief_id = p_brief_id
  ) c
  left join public.questions q on q.brief_id = p_brief_id and q.created_by = c.creator_id
  where public.is_superadmin() or public.has_role('content_manager')
  group by c.creator_id;
$$;

revoke execute on function public.brief_progress(uuid[]) from public, anon;
revoke execute on function public.brief_contributions(uuid) from public, anon;
grant execute on function public.brief_progress(uuid[]) to authenticated;
grant execute on function public.brief_contributions(uuid) to authenticated;
