-- PrepCode Practice, step 1 (PRACTICE.md §4): domains (the headings on PrepCode's Practice screen, e.g. "Technical")
-- holding categories (the cards, e.g. "Programming Basics"). New `pc_` tables, kept apart from prepwisely's own
-- categories and questions until a merge is decided; no existing table is changed. Superadmin and content managers
-- write them through the functions below (tables are read-only to clients). PrepCode reads active domains and
-- categories, guests included. Domains and categories are always free: paid access is per question (a later
-- migration). Nothing is deleted: domains and categories are archived.

-- ---------------------------------------------------------------------------------------------------------
-- Who manages Practice
-- ---------------------------------------------------------------------------------------------------------

create function public.pc_can_manage()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_superadmin() or public.has_role('content_manager');
$$;
revoke all on function public.pc_can_manage() from public, anon;
grant execute on function public.pc_can_manage() to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------

create table public.pc_domains (
  id uuid primary key default gen_random_uuid(),
  -- Fixed once created; PrepCode can use it as a stable key.
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 64),
  title text not null check (btrim(title) <> '' and length(title) <= 60),
  -- Display order on the Practice screen, smallest first.
  position integer not null check (position >= 1),
  created_by uuid not null references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.profiles(id),
  constraint pc_domains_archive_pair check ((archived_by is null) = (archived_at is null)),
  -- Deferred so a reorder can swap positions in one statement.
  constraint pc_domains_position_key unique (position) deferrable initially deferred
);

create unique index pc_domains_slug_key on public.pc_domains (slug);
create unique index pc_domains_title_key on public.pc_domains (lower(title));
create index pc_domains_created_by_idx on public.pc_domains (created_by);
create index pc_domains_updated_by_idx on public.pc_domains (updated_by);
create index pc_domains_archived_by_idx on public.pc_domains (archived_by);

create trigger pc_domains_set_updated_at
  before update on public.pc_domains
  for each row execute function public.set_updated_at();

create table public.pc_categories (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null references public.pc_domains(id) on delete restrict,
  -- Fixed once created, unique across all domains.
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 64),
  title text not null check (btrim(title) <> '' and length(title) <= 60),
  -- One sentence on the card.
  description text not null check (btrim(description) <> '' and length(description) <= 200),
  -- A lucide icon PrepCode knows; ignored when logo_url is set. Null shows PrepCode's folder icon.
  icon text check (icon in (
    'boxes', 'brain', 'briefcase', 'building-2', 'calculator', 'cpu', 'database', 'globe', 'puzzle', 'spell-check',
    'square-terminal'
  )),
  -- A company logo (https or an inline image data URL), shown instead of the icon.
  logo_url text check (logo_url is null or (logo_url ~ '^(https://|data:image/)' and length(logo_url) <= 200000)),
  -- Markdown shown above the questions, e.g. a company's exam pattern and eligibility.
  details text check (details is null or (btrim(details) <> '' and length(details) <= 20000)),
  -- Order within the domain, smallest first.
  position integer not null check (position >= 1),
  created_by uuid not null references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.profiles(id),
  constraint pc_categories_archive_pair check ((archived_by is null) = (archived_at is null)),
  constraint pc_categories_position_key unique (domain_id, position) deferrable initially deferred
);

create unique index pc_categories_slug_key on public.pc_categories (slug);
-- Titles are unique within a domain, regardless of case.
create unique index pc_categories_domain_title_key on public.pc_categories (domain_id, lower(title));
create index pc_categories_created_by_idx on public.pc_categories (created_by);
create index pc_categories_updated_by_idx on public.pc_categories (updated_by);
create index pc_categories_archived_by_idx on public.pc_categories (archived_by);

create trigger pc_categories_set_updated_at
  before update on public.pc_categories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------------------
-- Read access
-- ---------------------------------------------------------------------------------------------------------

alter table public.pc_domains enable row level security;
alter table public.pc_categories enable row level security;
-- This project auto-grants full privileges on new tables; revoke, then grant read only.
revoke all on public.pc_domains from public, anon, authenticated;
revoke all on public.pc_categories from public, anon, authenticated;
grant select on public.pc_domains to anon, authenticated;
grant select on public.pc_categories to anon, authenticated;

-- PrepCode (guests and signed-in students): active domains, and active categories of active domains.
create policy "active pc domains readable by everyone"
  on public.pc_domains for select to anon, authenticated
  using (archived_at is null);

create policy "active pc categories readable by everyone"
  on public.pc_categories for select to anon, authenticated
  using (
    archived_at is null
    and exists (select 1 from public.pc_domains d where d.id = domain_id and d.archived_at is null)
  );

-- prepwisely: superadmin and content managers also see archived ones.
create policy "all pc domains readable by practice managers"
  on public.pc_domains for select to authenticated
  using ((select public.pc_can_manage()));

create policy "all pc categories readable by practice managers"
  on public.pc_categories for select to authenticated
  using ((select public.pc_can_manage()));

-- ---------------------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------------------

-- Trimmed, with runs of whitespace collapsed to one space.
create function public.pc_clean_text(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(btrim(coalesce(p_text, '')), '\s+', ' ', 'g');
$$;
revoke all on function public.pc_clean_text(text) from public, anon, authenticated;

-- Lowercased and checked; raises with a readable message. Returns the clean slug.
create function public.pc_check_slug(p_slug text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
begin
  if v_slug = '' then
    raise exception 'Slug is required';
  end if;
  if length(v_slug) > 64 then
    raise exception 'Slug can be at most 64 characters';
  end if;
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Slug can only use lowercase letters, digits and single hyphens (for example programming-basics)';
  end if;
  return v_slug;
end;
$$;
revoke all on function public.pc_check_slug(text) from public, anon, authenticated;

-- Checks a category's fields (already cleaned), raising on the first problem.
create function public.pc_category_check(
  p_category_id uuid,
  p_domain_id uuid,
  p_title text,
  p_description text,
  p_icon text,
  p_logo_url text,
  p_details text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.pc_domains where id = p_domain_id) then
    raise exception 'Domain not found';
  end if;
  if exists (select 1 from public.pc_domains where id = p_domain_id and archived_at is not null) then
    raise exception 'That domain is archived. Restore it first.';
  end if;
  if p_title = '' then
    raise exception 'Title is required';
  end if;
  if length(p_title) > 60 then
    raise exception 'Title can be at most 60 characters';
  end if;
  if exists (
    select 1 from public.pc_categories
    where domain_id = p_domain_id and lower(title) = lower(p_title) and id is distinct from p_category_id
  ) then
    raise exception 'This domain already has a category named "%"', p_title;
  end if;
  if p_description = '' then
    raise exception 'Description is required';
  end if;
  if length(p_description) > 200 then
    raise exception 'Description can be at most 200 characters';
  end if;
  if p_icon is not null and p_icon not in (
    'boxes', 'brain', 'briefcase', 'building-2', 'calculator', 'cpu', 'database', 'globe', 'puzzle', 'spell-check',
    'square-terminal'
  ) then
    raise exception 'PrepCode doesn''t know the icon "%"', p_icon;
  end if;
  if p_logo_url is not null and p_logo_url !~ '^(https://|data:image/)' then
    raise exception 'The logo must be an https link or an uploaded image';
  end if;
  if p_logo_url is not null and length(p_logo_url) > 200000 then
    raise exception 'The logo image is too large (keep it under about 150 KB)';
  end if;
  if p_details is not null and length(p_details) > 20000 then
    raise exception 'Details can be at most 20,000 characters';
  end if;
end;
$$;
revoke all on function public.pc_category_check(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Domains: functions the app calls
-- ---------------------------------------------------------------------------------------------------------

-- Adds a domain at the end of the Practice screen and returns its id.
create function public.pc_domain_create(p_slug text, p_title text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_title text := public.pc_clean_text(p_title);
  v_id uuid;
begin
  if not public.pc_can_manage() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  v_slug := public.pc_check_slug(p_slug);
  if exists (select 1 from public.pc_domains where slug = v_slug) then
    raise exception 'A domain with the slug "%" already exists', v_slug;
  end if;
  if v_title = '' then
    raise exception 'Title is required';
  end if;
  if length(v_title) > 60 then
    raise exception 'Title can be at most 60 characters';
  end if;
  if exists (select 1 from public.pc_domains where lower(title) = lower(v_title)) then
    raise exception 'A domain named "%" already exists', v_title;
  end if;

  -- Serialise appends so two new domains can't take the same position.
  perform pg_advisory_xact_lock(hashtext('pc_domains_position'));
  insert into public.pc_domains (slug, title, position, created_by)
  values (
    v_slug,
    v_title,
    coalesce((select max(position) from public.pc_domains), 0) + 1,
    (select auth.uid())
  )
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.pc_domain_create(text, text) from public, anon;
grant execute on function public.pc_domain_create(text, text) to authenticated;

-- Renames a domain (the slug never changes). Archived domains can't be edited: restore first.
create function public.pc_domain_update(p_domain_id uuid, p_title text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := public.pc_clean_text(p_title);
  v_archived timestamptz;
begin
  if not public.pc_can_manage() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select archived_at into v_archived from public.pc_domains where id = p_domain_id for update;
  if not found then
    raise exception 'Domain not found';
  end if;
  if v_archived is not null then
    raise exception 'This domain is archived. Restore it before editing.';
  end if;
  if v_title = '' then
    raise exception 'Title is required';
  end if;
  if length(v_title) > 60 then
    raise exception 'Title can be at most 60 characters';
  end if;
  if exists (select 1 from public.pc_domains where lower(title) = lower(v_title) and id <> p_domain_id) then
    raise exception 'A domain named "%" already exists', v_title;
  end if;

  update public.pc_domains set title = v_title, updated_by = (select auth.uid()) where id = p_domain_id;
end;
$$;
revoke all on function public.pc_domain_update(uuid, text) from public, anon;
grant execute on function public.pc_domain_update(uuid, text) to authenticated;

-- Archive (hidden from PrepCode with all its categories) or restore. Its categories keep their own state.
create function public.pc_domain_set_archived(p_domain_id uuid, p_archived boolean)
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
  update public.pc_domains
  set archived_at = case when p_archived then coalesce(archived_at, now()) end,
      archived_by = case when p_archived then coalesce(archived_by, (select auth.uid())) end
  where id = p_domain_id;
  if not found then
    raise exception 'Domain not found';
  end if;
end;
$$;
revoke all on function public.pc_domain_set_archived(uuid, boolean) from public, anon;
grant execute on function public.pc_domain_set_archived(uuid, boolean) to authenticated;

-- Sets the order of every domain (archived ones included): the first id is shown first.
create function public.pc_domains_reorder(p_domain_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.pc_can_manage() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('pc_domains_position'));
  if p_domain_ids is null
     or array_position(p_domain_ids, null) is not null
     or (select count(distinct x) from unnest(p_domain_ids) x) <> cardinality(p_domain_ids)
     or cardinality(p_domain_ids) <> (select count(*) from public.pc_domains)
     or exists (select 1 from unnest(p_domain_ids) x where not exists (select 1 from public.pc_domains d where d.id = x))
  then
    raise exception 'The domain list has changed. Refresh and try again.';
  end if;

  update public.pc_domains d
  set position = x.position::integer
  from unnest(p_domain_ids) with ordinality as x(id, position)
  where d.id = x.id and d.position <> x.position::integer;
end;
$$;
revoke all on function public.pc_domains_reorder(uuid[]) from public, anon;
grant execute on function public.pc_domains_reorder(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Categories: functions the app calls
-- ---------------------------------------------------------------------------------------------------------

-- Adds a category at the end of its domain and returns its id.
create function public.pc_category_create(
  p_domain_id uuid,
  p_slug text,
  p_title text,
  p_description text,
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
  -- Lock the domain so concurrent appends to it can't take the same position.
  perform 1 from public.pc_domains where id = p_domain_id for update;
  perform public.pc_category_check(null, p_domain_id, v_title, v_description, v_icon, v_logo_url, v_details);

  insert into public.pc_categories
    (domain_id, slug, title, description, icon, logo_url, details, position, created_by)
  values (
    p_domain_id, v_slug, v_title, v_description, v_icon, v_logo_url, v_details,
    coalesce((select max(position) from public.pc_categories where domain_id = p_domain_id), 0) + 1,
    (select auth.uid())
  )
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.pc_category_create(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.pc_category_create(uuid, text, text, text, text, text, text) to authenticated;

-- Replaces a category's fields (the slug never changes). Moving it to another domain puts it last there.
-- Archived categories can't be edited: restore first.
create function public.pc_category_update(
  p_category_id uuid,
  p_domain_id uuid,
  p_title text,
  p_description text,
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
  if p_domain_id is distinct from v_current.domain_id then
    perform 1 from public.pc_domains where id = p_domain_id for update;
  end if;
  perform public.pc_category_check(p_category_id, p_domain_id, v_title, v_description, v_icon, v_logo_url, v_details);

  update public.pc_categories
  set domain_id = p_domain_id,
      title = v_title,
      description = v_description,
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
revoke all on function public.pc_category_update(uuid, uuid, text, text, text, text, text) from public, anon;
grant execute on function public.pc_category_update(uuid, uuid, text, text, text, text, text) to authenticated;

-- Archive (hidden from PrepCode) or restore.
create function public.pc_category_set_archived(p_category_id uuid, p_archived boolean)
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
  update public.pc_categories
  set archived_at = case when p_archived then coalesce(archived_at, now()) end,
      archived_by = case when p_archived then coalesce(archived_by, (select auth.uid())) end
  where id = p_category_id;
  if not found then
    raise exception 'Category not found';
  end if;
end;
$$;
revoke all on function public.pc_category_set_archived(uuid, boolean) from public, anon;
grant execute on function public.pc_category_set_archived(uuid, boolean) to authenticated;

-- Sets the order of every category in a domain (archived ones included): the first id is shown first.
create function public.pc_categories_reorder(p_domain_id uuid, p_category_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.pc_can_manage() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform 1 from public.pc_domains where id = p_domain_id for update;
  if not found then
    raise exception 'Domain not found';
  end if;
  if p_category_ids is null
     or array_position(p_category_ids, null) is not null
     or (select count(distinct x) from unnest(p_category_ids) x) <> cardinality(p_category_ids)
     or cardinality(p_category_ids) <> (select count(*) from public.pc_categories where domain_id = p_domain_id)
     or exists (
       select 1 from unnest(p_category_ids) x
       where not exists (select 1 from public.pc_categories c where c.id = x and c.domain_id = p_domain_id)
     )
  then
    raise exception 'The category list has changed. Refresh and try again.';
  end if;

  update public.pc_categories c
  set position = x.position::integer
  from unnest(p_category_ids) with ordinality as x(id, position)
  where c.id = x.id and c.position <> x.position::integer;
end;
$$;
revoke all on function public.pc_categories_reorder(uuid, uuid[]) from public, anon;
grant execute on function public.pc_categories_reorder(uuid, uuid[]) to authenticated;
