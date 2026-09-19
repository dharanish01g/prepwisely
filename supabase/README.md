# Supabase backend

Source of truth for the Supabase project `prepwisely` (`gjlynpdgovgyyklamtds`).

- `migrations/` — SQL applied to the database, named by the version Supabase recorded.
  Add new changes as new files; never edit an applied one.
- `functions/admin-users/` — superadmin-only Edge Function (create, update, reset password,
  set status for staff). Deployed with JWT verification on.

The first superadmin is created by a developer in Supabase Auth, then given a `profiles` row and a
`user_roles` row with `role_id = 'superadmin'`. Every other account is created from the app.
