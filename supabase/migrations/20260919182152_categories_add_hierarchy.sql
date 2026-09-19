alter table public.categories
  add column slug text,
  add column parent_id uuid references public.categories (id) on delete restrict,
  add column is_active boolean not null default true;

-- Backfill slugs for existing rows from the name.
update public.categories
set slug = coalesce(nullif(trim(both '-' from regexp_replace(lower(btrim(name)), '[^a-z0-9]+', '-', 'g')), ''), id::text);

alter table public.categories alter column slug set not null;

alter table public.categories
  add constraint categories_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  add constraint categories_not_own_parent check (parent_id is distinct from id);

-- Slugs are globally unique. Names are unique only among siblings (same parent), so
-- "Basics" can exist under both "Maths" and "Physics".
drop index public.categories_name_key;
create unique index categories_slug_key on public.categories (slug);
create unique index categories_parent_name_key
  on public.categories (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));
create index categories_parent_id_idx on public.categories (parent_id);

-- A category can't be moved under itself or one of its own descendants.
create function public.prevent_category_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is not null and exists (
    with recursive ancestors as (
      select id, parent_id from public.categories where id = new.parent_id
      union all
      select c.id, c.parent_id from public.categories c join ancestors a on c.id = a.parent_id
    )
    select 1 from ancestors where id = new.id
  ) then
    raise exception 'A category cannot be moved under itself or one of its own subcategories';
  end if;
  return new;
end;
$$;

create trigger categories_prevent_cycle
  before insert or update of parent_id on public.categories
  for each row execute function public.prevent_category_cycle();
