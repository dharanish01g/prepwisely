-- Students may now also sign up with email and a password (confirmed with a code sent by email). Like an account
-- started with Google, it can't be used in prepcode until the student connects GitHub. Staff, faculty and TPO accounts
-- are still made by the admin functions, which don't run this hook. Anonymous, phone, SAML and the rest stay refused.
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  if event->'user'->'app_metadata'->>'provider' in ('github', 'google', 'email') then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'New accounts are created with GitHub, Google or email.'
  ));
end;
$$;

-- An account that started with Google or email but never connected GitHub can't be used in prepcode. Delete those
-- after three days, unless a staff, student, faculty or TPO row holds on to them (prepwisely's own email accounts all
-- have one, so this never removes them).
create or replace function public.delete_abandoned_accounts()
returns integer
language sql
security definer
set search_path = ''
as $$
  with deleted as (
    delete from auth.users u
    where u.created_at < now() - interval '3 days'
      and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'github')
      and exists (select 1 from auth.identities i where i.user_id = u.id and i.provider in ('google', 'email'))
      and not exists (select 1 from public.profiles p where p.id = u.id)
      and not exists (select 1 from public.students s where s.id = u.id)
      and not exists (select 1 from public.faculty f where f.id = u.id)
      and not exists (select 1 from public.tpo t where t.id = u.id)
    returning 1
  )
  select count(*)::integer from deleted;
$$;
revoke all on function public.delete_abandoned_accounts() from public, anon, authenticated;
