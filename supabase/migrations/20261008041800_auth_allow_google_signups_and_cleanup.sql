-- A student may now start with Google: the account is created, and prepcode then asks them to connect GitHub before
-- anything else (their GitHub may use a different email). Email sign-ups are still refused. Staff, faculty and TPO
-- accounts are made by the admin functions, which don't run this hook.
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  if event->'user'->'app_metadata'->>'provider' in ('github', 'google') then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'New accounts are created with GitHub or Google.'
  ));
end;
$$;

-- An account that started with Google but never connected GitHub can't be used in prepcode. Delete those after three
-- days, unless something else holds on to them (a staff, student, faculty or TPO row, which can't happen for them, but
-- is checked so this can never remove a real account).
create function public.delete_abandoned_accounts()
returns integer
language sql
security definer
set search_path = ''
as $$
  with deleted as (
    delete from auth.users u
    where u.created_at < now() - interval '3 days'
      and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'github')
      and exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'google')
      and not exists (select 1 from public.profiles p where p.id = u.id)
      and not exists (select 1 from public.students s where s.id = u.id)
      and not exists (select 1 from public.faculty f where f.id = u.id)
      and not exists (select 1 from public.tpo t where t.id = u.id)
    returning 1
  )
  select count(*)::integer from deleted;
$$;
revoke all on function public.delete_abandoned_accounts() from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
select cron.schedule('delete-abandoned-accounts', '30 21 * * *', 'select public.delete_abandoned_accounts()');
