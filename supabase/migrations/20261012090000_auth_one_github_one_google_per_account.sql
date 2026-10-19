-- One GitHub and one Google per account. Supabase adds a sign-in to an existing account on its own when one of its
-- verified emails matches, and the browser on a shared lab computer is often still signed in to the previous
-- student's GitHub or Google. Together they put a second student's GitHub or Gmail on someone else's account, and
-- that student then signs in to it. Refusing a second one of either ends the sign-in with this message instead.
-- Signing in with a GitHub or Google the account already has doesn't add an identity, so it isn't affected.
create function public.refuse_second_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.provider in ('github', 'google') and exists (
    select 1 from auth.identities i
    where i.user_id = new.user_id and i.provider = new.provider and i.id <> new.id
  ) then
    raise exception using
      errcode = 'P0001',
      message = case new.provider
        when 'github' then 'This GitHub shares an email with a prepcode account that already has a GitHub. '
                           'Sign in with that account''s GitHub, or remove the shared email from this GitHub.'
        else 'This prepcode account already has a Gmail. Disconnect it in Profile → Gmail first.'
      end;
  end if;
  return new;
end;
$$;
revoke all on function public.refuse_second_identity() from public, anon, authenticated;

create trigger refuse_second_identity
  before insert on auth.identities
  for each row execute function public.refuse_second_identity();
