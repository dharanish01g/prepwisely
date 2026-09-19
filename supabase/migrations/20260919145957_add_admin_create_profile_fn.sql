-- Atomically creates a staff profile and its role. Callable only by the service role (Edge Function).
create function public.admin_create_profile(
  p_id uuid,
  p_full_name text,
  p_email text,
  p_phone text,
  p_address text,
  p_role_id text,
  p_created_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, phone, address, created_by)
  values (p_id, p_full_name, p_email, p_phone, p_address, p_created_by);

  insert into public.user_roles (user_id, role_id)
  values (p_id, p_role_id);
end;
$$;

revoke execute on function public.admin_create_profile(uuid, text, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_create_profile(uuid, text, text, text, text, text, uuid) to service_role;
