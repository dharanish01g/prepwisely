-- Question kinds get the same fields as a Practice card: a title (was label), a slug (the id, now in the same
-- lowercase-and-hyphens format as card slugs), a one-sentence description and a Lucide icon. Nothing outside
-- prepwisely reads question_kinds yet, so the rename is safe; the existing ids (mcq, coding) are valid slugs.

alter table public.question_kinds rename column label to title;
alter table public.question_kinds drop constraint question_kinds_label_check;
alter table public.question_kinds add constraint question_kinds_title_check check (length(title) between 1 and 60);
alter index public.question_kinds_label_key rename to question_kinds_title_key;

alter table public.question_kinds drop constraint question_kinds_id_check;
alter table public.question_kinds
  add constraint question_kinds_id_check check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(id) <= 64);

alter table public.question_kinds
  add column description text not null default '' check (length(description) <= 200),
  add column icon text check (icon ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(icon) <= 64);

update public.question_kinds set description = 'Pick the one correct answer from the options.', icon = 'list-checks' where id = 'mcq';
update public.question_kinds set description = 'Write code that passes every test case.', icon = 'code' where id = 'coding';
alter table public.question_kinds alter column description drop default;

-- Create and update take every field; the old create/rename go.
drop function public.question_kind_create(text, text);
drop function public.question_kind_rename(text, text);

create function public.question_kind_check(p_id text, p_title text, p_description text, p_icon text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_title = '' or length(p_title) > 60 then
    raise exception 'Title is required, at most 60 characters';
  end if;
  if p_description = '' or length(p_description) > 200 then
    raise exception 'Description is required, at most 200 characters';
  end if;
  if p_icon is not null and (p_icon !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_icon) > 64) then
    raise exception '"%" isn''t a Lucide icon name', p_icon;
  end if;
  if exists (select 1 from public.question_kinds where lower(title) = lower(p_title) and id is distinct from p_id) then
    raise exception 'A kind named "%" already exists', p_title;
  end if;
end;
$$;
revoke all on function public.question_kind_check(text, text, text, text) from public, anon, authenticated;

-- Adds a kind at the end. The slug is fixed once created (cards store it).
create function public.question_kind_create(p_slug text, p_title text, p_description text, p_icon text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_title text := public.pc_clean_text(p_title);
  v_description text := public.pc_clean_text(p_description);
  v_icon text := nullif(btrim(coalesce(p_icon, '')), '');
begin
  if not public.pc_can_manage() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_slug) > 64 then
    raise exception 'The slug can only use lowercase letters, digits and single hyphens (for example fill-blank), at most 64';
  end if;
  -- Lock the table so two adds can't both pass the checks below or take the same position.
  lock table public.question_kinds in share row exclusive mode;
  if exists (select 1 from public.question_kinds where id = v_slug) then
    raise exception 'A kind with the slug "%" already exists', v_slug;
  end if;
  perform public.question_kind_check(null, v_title, v_description, v_icon);
  insert into public.question_kinds (id, title, description, icon, position)
  values (v_slug, v_title, v_description, v_icon, coalesce((select max(position) from public.question_kinds), 0) + 1);
end;
$$;
revoke all on function public.question_kind_create(text, text, text, text) from public, anon;
grant execute on function public.question_kind_create(text, text, text, text) to authenticated;

-- Replaces every field but the slug. Archived kinds must be restored first.
create function public.question_kind_update(p_id text, p_title text, p_description text, p_icon text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := public.pc_clean_text(p_title);
  v_description text := public.pc_clean_text(p_description);
  v_icon text := nullif(btrim(coalesce(p_icon, '')), '');
  v_current public.question_kinds;
begin
  if not public.pc_can_manage() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into v_current from public.question_kinds where id = p_id for update;
  if not found then
    raise exception 'Kind not found';
  end if;
  if v_current.archived_at is not null then
    raise exception 'This kind is archived. Restore it before editing.';
  end if;
  perform public.question_kind_check(p_id, v_title, v_description, v_icon);
  update public.question_kinds set title = v_title, description = v_description, icon = v_icon where id = p_id;
end;
$$;
revoke all on function public.question_kind_update(text, text, text, text) from public, anon;
grant execute on function public.question_kind_update(text, text, text, text) to authenticated;
