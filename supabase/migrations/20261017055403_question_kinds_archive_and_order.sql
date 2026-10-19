-- Question kinds get the same controls as Practice domains and categories: archive / restore and ordering.
--
-- Archived kinds stay readable (PrepCode still needs the kind of every card), but no card can newly take one: a new
-- card can't pick it and a card can't switch to it. Cards that already use it keep it. Archived kinds must be restored
-- before they're renamed. Nothing is deleted.

alter table public.question_kinds
  add column archived_at timestamptz,
  add column archived_by uuid references public.profiles(id);

-- Reordering rewrites positions row by row, which a unique position would refuse mid-way (as pc_domains, no unique).
alter table public.question_kinds drop constraint question_kinds_position_key;

-- Covers every write path to pc_categories (create, update, anything later).
create function public.pc_categories_check_kind_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or new.question_kind is distinct from old.question_kind)
     and exists (select 1 from public.question_kinds where id = new.question_kind and archived_at is not null) then
    raise exception 'That question kind is archived. Restore it first.';
  end if;
  return new;
end;
$$;
revoke all on function public.pc_categories_check_kind_active() from public, anon, authenticated;

create trigger pc_categories_check_kind_active
  before insert or update of question_kind on public.pc_categories
  for each row execute function public.pc_categories_check_kind_active();

create or replace function public.question_kind_rename(p_id text, p_label text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text := public.pc_clean_text(p_label);
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
  if v_label = '' or length(v_label) > 40 then
    raise exception 'Label is required, at most 40 characters';
  end if;
  if exists (select 1 from public.question_kinds where lower(label) = lower(v_label) and id <> p_id) then
    raise exception 'A kind named "%" already exists', v_label;
  end if;
  update public.question_kinds set label = v_label where id = p_id;
end;
$$;

create function public.question_kind_set_archived(p_id text, p_archived boolean)
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
  update public.question_kinds
  set archived_at = case when p_archived then coalesce(archived_at, now()) end,
      archived_by = case when p_archived then coalesce(archived_by, (select auth.uid())) end
  where id = p_id;
  if not found then
    raise exception 'Kind not found';
  end if;
end;
$$;
revoke all on function public.question_kind_set_archived(text, boolean) from public, anon;
grant execute on function public.question_kind_set_archived(text, boolean) to authenticated;

-- Every kind's id (archived included) in the new order.
create function public.question_kinds_reorder(p_ids text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.pc_can_manage() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  lock table public.question_kinds in share row exclusive mode;
  if p_ids is null
     or array_position(p_ids, null) is not null
     or (select count(distinct x) from unnest(p_ids) x) <> cardinality(p_ids)
     or cardinality(p_ids) <> (select count(*) from public.question_kinds)
     or exists (select 1 from unnest(p_ids) x where not exists (select 1 from public.question_kinds k where k.id = x))
  then
    raise exception 'The kind list has changed. Refresh and try again.';
  end if;

  update public.question_kinds k
  set position = x.position::integer
  from unnest(p_ids) with ordinality as x(id, position)
  where k.id = x.id and k.position <> x.position::integer;
end;
$$;
revoke all on function public.question_kinds_reorder(text[]) from public, anon;
grant execute on function public.question_kinds_reorder(text[]) to authenticated;
