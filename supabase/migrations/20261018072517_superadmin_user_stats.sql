-- Sign-up statistics for the superadmin's Overview: how many accounts, how they signed up, and who came back.
--
-- Sign-in accounts live in auth.users, which the app can't read, so this function counts them and returns grouped
-- rows (no ids, names or emails); the app adds them up. Days are India days (Asia/Kolkata).
--
-- "Last seen" is the latest of the last sign-in and the last time one of the person's sessions was refreshed, so
-- someone who stays signed in for days still counts as seen. Sessions are deleted on sign-out or expiry, so this is
-- recent activity, not a full history: there is no record of every day someone used an app.

create function public.superadmin_user_stats()
returns table (
  -- 'signed_up': made their own account in PrepCode. 'added': a staff member, college student, faculty member or
  -- TPO, created from prepwisely.
  source text,
  -- How the account was first made: 'email', 'google' or 'github'.
  method text,
  created_day date,
  -- The India day the person was last seen; null if they never signed in.
  seen_day date,
  users integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Only the superadmin can see user statistics';
  end if;

  return query
  with sessions as (
    select s.user_id, max(greatest(s.updated_at, s.refreshed_at at time zone 'UTC')) as last_refresh
    from auth.sessions s
    group by s.user_id
  ),
  accounts as (
    select
      case
        when exists (select 1 from public.profiles p where p.id = u.id)
          or exists (select 1 from public.students st where st.id = u.id)
          or exists (select 1 from public.faculty f where f.id = u.id)
          or exists (select 1 from public.tpo t where t.id = u.id)
        then 'added'
        else 'signed_up'
      end as source,
      coalesce(u.raw_app_meta_data ->> 'provider', 'email') as method,
      (u.created_at at time zone 'Asia/Kolkata')::date as created_day,
      -- A session only exists after a sign-in, so with no sign-in this stays null.
      (case when u.last_sign_in_at is not null then greatest(u.last_sign_in_at, s.last_refresh) end
        at time zone 'Asia/Kolkata')::date as seen_day
    from auth.users u
    left join sessions s on s.user_id = u.id
    where u.deleted_at is null and not u.is_anonymous
  )
  select a.source, a.method, a.created_day, a.seen_day, count(*)::integer
  from accounts a
  group by a.source, a.method, a.created_day, a.seen_day;
end;
$$;

revoke all on function public.superadmin_user_stats() from public, anon;
grant execute on function public.superadmin_user_stats() to authenticated;
