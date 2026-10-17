-- PrepCode Practice: every card (pc_categories) holds one kind of question, picked from question_kinds.
--
-- Kinds are rows, not a check constraint, so a new kind (e.g. sql) is added on prepwisely's Question kinds page; it
-- still needs its own editor in prepwisely and screen in PrepCode before cards of that kind are useful. Starts with mcq
-- and coding. Superadmin and content managers add and rename kinds; kinds are never deleted (cards point to them).
-- A card's kind can change only while it has no questions. Existing cards hold coding questions, so they become coding.

create table public.question_kinds (
  id text primary key check (id ~ '^[a-z]+(_[a-z]+)*$' and length(id) <= 32),
  label text not null check (length(label) between 1 and 40),
  position integer not null unique
);

create unique index question_kinds_label_key on public.question_kinds (lower(label));

insert into public.question_kinds (id, label, position) values
  ('mcq', 'MCQ', 1),
  ('coding', 'Coding', 2);

alter table public.question_kinds enable row level security;
-- This project auto-grants full privileges on new tables; revoke, then grant read only. Writes go through the functions.
revoke all on public.question_kinds from public, anon, authenticated;
grant select on public.question_kinds to anon, authenticated;

create policy "question kinds readable by everyone"
  on public.question_kinds for select to anon, authenticated
  using (true);

alter table public.pc_categories
  add column question_kind text references public.question_kinds(id) on delete restrict;
update public.pc_categories set question_kind = 'coding';
alter table public.pc_categories alter column question_kind set not null;

-- Only coding questions exist so far (pc_questions has no kind of its own yet), so a question may only sit in a
-- coding card. Covers every write path: pc_question_save, imports and moves between cards.
create function public.pc_questions_check_kind()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select question_kind from public.pc_categories where id = new.category_id) is distinct from 'coding' then
    raise exception 'This category isn''t for coding questions';
  end if;
  return new;
end;
$$;
revoke all on function public.pc_questions_check_kind() from public, anon, authenticated;

create trigger pc_questions_check_kind
  before insert or update of category_id on public.pc_questions
  for each row execute function public.pc_questions_check_kind();

-- Create and update take the kind; the old signatures go.
drop function public.pc_category_create(uuid, text, text, text, text, text, text);
drop function public.pc_category_update(uuid, uuid, text, text, text, text, text);

create function public.pc_category_create(
  p_domain_id uuid,
  p_slug text,
  p_title text,
  p_description text,
  p_question_kind text,
  p_icon text default null,
  p_logo_url text default null,
  p_details text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_title text := public.pc_clean_text(p_title);
  v_description text := public.pc_clean_text(p_description);
  v_icon text := nullif(btrim(coalesce(p_icon, '')), '');
  v_logo_url text := nullif(btrim(coalesce(p_logo_url, '')), '');
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_id uuid;
begin
  if not public.pc_can_manage() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  v_slug := public.pc_check_slug(p_slug);
  if exists (select 1 from public.pc_categories where slug = v_slug) then
    raise exception 'A category with the slug "%" already exists', v_slug;
  end if;
  if not exists (select 1 from public.question_kinds where id = p_question_kind) then
    raise exception 'Choose a question kind';
  end if;
  -- Lock the domain so concurrent appends to it can't take the same position.
  perform 1 from public.pc_domains where id = p_domain_id for update;
  perform public.pc_category_check(null, p_domain_id, v_title, v_description, v_icon, v_logo_url, v_details);

  insert into public.pc_categories
    (domain_id, slug, title, description, question_kind, icon, logo_url, details, position, created_by)
  values (
    p_domain_id, v_slug, v_title, v_description, p_question_kind, v_icon, v_logo_url, v_details,
    coalesce((select max(position) from public.pc_categories where domain_id = p_domain_id), 0) + 1,
    (select auth.uid())
  )
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.pc_category_create(uuid, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.pc_category_create(uuid, text, text, text, text, text, text, text) to authenticated;

create function public.pc_category_update(
  p_category_id uuid,
  p_domain_id uuid,
  p_title text,
  p_description text,
  p_question_kind text,
  p_icon text,
  p_logo_url text,
  p_details text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := public.pc_clean_text(p_title);
  v_description text := public.pc_clean_text(p_description);
  v_icon text := nullif(btrim(coalesce(p_icon, '')), '');
  v_logo_url text := nullif(btrim(coalesce(p_logo_url, '')), '');
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_current public.pc_categories;
begin
  if not public.pc_can_manage() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into v_current from public.pc_categories where id = p_category_id for update;
  if not found then
    raise exception 'Category not found';
  end if;
  if v_current.archived_at is not null then
    raise exception 'This category is archived. Restore it before editing.';
  end if;
  if not exists (select 1 from public.question_kinds where id = p_question_kind) then
    raise exception 'Choose a question kind';
  end if;
  -- Archived questions count too: restoring one into a card of another kind would break the card.
  if p_question_kind <> v_current.question_kind
     and exists (select 1 from public.pc_questions where category_id = p_category_id) then
    raise exception 'This category already has questions, so its question kind can''t change';
  end if;
  if p_domain_id is distinct from v_current.domain_id then
    perform 1 from public.pc_domains where id = p_domain_id for update;
  end if;
  perform public.pc_category_check(p_category_id, p_domain_id, v_title, v_description, v_icon, v_logo_url, v_details);

  update public.pc_categories
  set domain_id = p_domain_id,
      title = v_title,
      description = v_description,
      question_kind = p_question_kind,
      icon = v_icon,
      logo_url = v_logo_url,
      details = v_details,
      position = case
        when p_domain_id = v_current.domain_id then position
        else coalesce((select max(c.position) from public.pc_categories c where c.domain_id = p_domain_id), 0) + 1
      end,
      updated_by = (select auth.uid())
  where id = p_category_id;
end;
$$;
revoke all on function public.pc_category_update(uuid, uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.pc_category_update(uuid, uuid, text, text, text, text, text, text) to authenticated;

-- Adds a kind at the end. The id is fixed once created (cards store it); the label can be renamed.
create function public.question_kind_create(p_id text, p_label text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text := lower(btrim(coalesce(p_id, '')));
  v_label text := public.pc_clean_text(p_label);
begin
  if not public.pc_can_manage() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if v_id !~ '^[a-z]+(_[a-z]+)*$' or length(v_id) > 32 then
    raise exception 'The id can only use lowercase letters and single underscores (for example fill_blank), at most 32';
  end if;
  if v_label = '' or length(v_label) > 40 then
    raise exception 'Label is required, at most 40 characters';
  end if;
  -- Lock the table so two adds can't both pass the checks below or take the same position.
  lock table public.question_kinds in share row exclusive mode;
  if exists (select 1 from public.question_kinds where id = v_id) then
    raise exception 'A kind with the id "%" already exists', v_id;
  end if;
  if exists (select 1 from public.question_kinds where lower(label) = lower(v_label)) then
    raise exception 'A kind named "%" already exists', v_label;
  end if;
  insert into public.question_kinds (id, label, position)
  values (v_id, v_label, coalesce((select max(position) from public.question_kinds), 0) + 1);
end;
$$;
revoke all on function public.question_kind_create(text, text) from public, anon;
grant execute on function public.question_kind_create(text, text) to authenticated;

create function public.question_kind_rename(p_id text, p_label text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text := public.pc_clean_text(p_label);
begin
  if not public.pc_can_manage() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if v_label = '' or length(v_label) > 40 then
    raise exception 'Label is required, at most 40 characters';
  end if;
  if exists (select 1 from public.question_kinds where lower(label) = lower(v_label) and id <> p_id) then
    raise exception 'A kind named "%" already exists', v_label;
  end if;
  update public.question_kinds set label = v_label where id = p_id;
  if not found then
    raise exception 'Kind not found';
  end if;
end;
$$;
revoke all on function public.question_kind_rename(text, text) from public, anon;
grant execute on function public.question_kind_rename(text, text) to authenticated;
