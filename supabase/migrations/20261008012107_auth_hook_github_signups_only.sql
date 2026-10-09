-- Supabase Auth calls this before creating any account (the Before User Created hook, enabled in the dashboard under
-- Authentication > Hooks). Only GitHub may create an account; an email (or Google) can only be attached to one.
-- Accounts made by prepwisely's admin-users / college-users edge functions use the admin "create user" API, which
-- doesn't run this hook, so staff, faculty and TPO accounts are unaffected. Signing in never runs it either.
create function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  if event->'user'->'app_metadata'->>'provider' = 'github' then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'New accounts are created with GitHub. Continue with GitHub first.'
  ));
end;
$$;

grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
