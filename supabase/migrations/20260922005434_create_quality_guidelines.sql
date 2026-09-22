-- A single markdown document: the quality bar reviewers check questions against. Maintained by the
-- content manager (and superadmin); readable by the whole content team (manager, reviewer, creator).

create table public.quality_guidelines (
  id smallint primary key default 1 check (id = 1),
  content text not null default '',
  updated_by uuid references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now()
);

insert into public.quality_guidelines (id, content) values (1, '');

create function public.quality_guidelines_track_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  new.updated_by = (select auth.uid());
  return new;
end;
$$;

create trigger quality_guidelines_set_updated
  before update on public.quality_guidelines
  for each row execute function public.quality_guidelines_track_update();

alter table public.quality_guidelines enable row level security;

create policy "content team reads quality guidelines"
on public.quality_guidelines for select
to authenticated
using (
  (select public.is_superadmin())
  or (select public.has_role('content_manager'))
  or (select public.has_role('content_reviewer'))
  or (select public.has_role('content_creator'))
);

create policy "content manager writes quality guidelines"
on public.quality_guidelines for update
to authenticated
using ((select public.is_superadmin()) or (select public.has_role('content_manager')))
with check ((select public.is_superadmin()) or (select public.has_role('content_manager')));

revoke all on public.quality_guidelines from public, anon, authenticated;
grant select on public.quality_guidelines to authenticated;
grant update (content) on public.quality_guidelines to authenticated;
