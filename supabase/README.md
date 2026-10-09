# Supabase backend

Source of truth for the Supabase project `prepwisely` (`gjlynpdgovgyyklamtds`).

- `migrations/` — SQL applied to the database, named by the version Supabase recorded.
  Add new changes as new files; never edit an applied one.
- `functions/admin-users/` — superadmin-only Edge Function (create, update, reset password,
  set status for staff). Deployed with JWT verification on.
- `functions/github-token/` — gives a signed-in prepcode student a one-hour GitHub token for their
  `prepcode-programs` repo only, from the prepcodes GitHub App. Once the app is installed, it creates that repo if
  it doesn't exist yet (the app's "Repository creation" permission). Secrets: `GITHUB_APP_ID`,
  `GITHUB_APP_PRIVATE_KEY`. Deployed with JWT verification on.
- `functions/discard-pending-account/` — deletes the caller's own account while it's still waiting for GitHub
  (started with Google or email, no GitHub, no staff/student/faculty/TPO row), so prepcode can move that login to the
  account their GitHub already has. Deployed with JWT verification on.
- Auth hook — Authentication > Hooks > Before User Created runs the Postgres function
  `public.hook_before_user_created`: a GitHub, Google or email sign-up may create an account (email needs a confirm code, and not from a domain in `public.blocked_signup_email_domains`: Gmail, which uses Continue with Google — add rows there to block more providers, no app release needed). A daily
  `pg_cron` job, `delete-abandoned-accounts`, removes Google or email accounts that never connected GitHub after 3 days. The hook is switched on in the
  dashboard, not by a migration. Accounts created by the edge functions (admin create user) don't run it.

The first superadmin is created by a developer in Supabase Auth, then given a `profiles` row and a
`user_roles` row with `role_id = 'superadmin'`. Every other account is created from the app.
