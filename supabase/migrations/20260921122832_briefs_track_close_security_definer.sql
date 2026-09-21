-- The category lock must see every linked question, including other people's drafts that the calling manager
-- can't read under RLS, so this trigger function runs as its owner.
create or replace function public.briefs_track_close()
returns trigger
language plpgsql
security definer
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

revoke execute on function public.briefs_track_close() from public, anon, authenticated;
