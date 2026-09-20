-- Replaces a staff user's role in one transaction. Callable only by the service role (admin-users Edge Function).
-- The UI assigns one role per user, so this leaves the user with exactly that role. Previous assignments are
-- removed (nothing references user_roles rows, so this doesn't break the no-deletes rule for real data).
-- Refuses to leave the platform without an active superadmin.
create function public.admin_set_user_role(p_user_id uuid, p_role_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'User not found';
  end if;
  if not exists (select 1 from public.roles where id = p_role_id) then
    raise exception 'Unknown role';
  end if;

  if p_role_id <> 'superadmin' then
    -- Serialise concurrent demotions so two superadmins can't remove each other at the same time.
    perform 1 from public.user_roles where role_id = 'superadmin' for update;

    if exists (select 1 from public.user_roles where user_id = p_user_id and role_id = 'superadmin')
       and not exists (
         select 1
         from public.user_roles ur
         join public.profiles p on p.id = ur.user_id
         where ur.role_id = 'superadmin' and p.status = 'active' and ur.user_id <> p_user_id
       ) then
      raise exception 'There must be at least one other active superadmin';
    end if;
  end if;

  delete from public.user_roles where user_id = p_user_id and role_id <> p_role_id;
  insert into public.user_roles (user_id, role_id) values (p_user_id, p_role_id) on conflict do nothing;
end;
$$;

revoke execute on function public.admin_set_user_role(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_set_user_role(uuid, text) to service_role;
