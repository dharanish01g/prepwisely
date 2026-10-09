-- Email + password is for college and work email. Personal email that has its own way to sign in is refused there, so
-- a student doesn't end up with two logins for the same address: Gmail signs in with Continue with Google. More
-- providers are added later as rows here; no app release needed (the app shows the hook's message).
create table public.blocked_signup_email_domains (
  domain text primary key check (domain = lower(btrim(domain)) and domain <> ''),
  -- Shown to the student, e.g. "Use Continue with Google for Gmail."
  message text not null check (btrim(message) <> ''),
  created_at timestamptz not null default now()
);

alter table public.blocked_signup_email_domains enable row level security;
revoke all on public.blocked_signup_email_domains from public, anon, authenticated;
grant select on public.blocked_signup_email_domains to supabase_auth_admin;
create policy "auth hook reads blocked domains"
  on public.blocked_signup_email_domains for select to supabase_auth_admin using (true);

insert into public.blocked_signup_email_domains (domain, message) values
  ('gmail.com', 'Gmail addresses sign in with Continue with Google. Use your college or work email for email and password.'),
  ('googlemail.com', 'Gmail addresses sign in with Continue with Google. Use your college or work email for email and password.');

-- GitHub, Google or email may create an account; email only from a domain that isn't blocked above.
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_provider text := event->'user'->'app_metadata'->>'provider';
  v_domain text := lower(split_part(event->'user'->>'email', '@', 2));
  v_blocked text;
begin
  if v_provider = 'email' then
    select b.message into v_blocked from public.blocked_signup_email_domains b where b.domain = v_domain;
    if v_blocked is not null then
      return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', v_blocked));
    end if;
  end if;
  if v_provider in ('github', 'google', 'email') then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'New accounts are created with GitHub, Google or email.'
  ));
end;
$$;
