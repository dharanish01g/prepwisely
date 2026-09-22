alter table public.colleges
  add column city text,
  add column state text,
  add column address text;

revoke update on public.colleges from authenticated;
grant update (name, contact_prefix, contact_name, contact_email, contact_phone, contact_phone_alt, city, state, address)
  on public.colleges to authenticated;

drop function public.onboarding_create_college(text, text, text, text, text, text);

create function public.onboarding_create_college(
  p_name text,
  p_contact_name text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_contact_prefix text default null,
  p_contact_phone_alt text default null,
  p_city text default null,
  p_state text default null,
  p_address text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not (public.is_superadmin() or public.has_role('onboarding_manager')) then
    raise exception 'Not authorized';
  end if;

  insert into public.colleges (name, contact_prefix, contact_name, contact_email, contact_phone, contact_phone_alt, city, state, address, created_by)
  values (p_name, p_contact_prefix, p_contact_name, p_contact_email, p_contact_phone, p_contact_phone_alt, p_city, p_state, p_address, (select auth.uid()))
  returning id into v_id;

  if public.has_role('onboarding_manager') then
    insert into public.onboarding_manager_colleges (manager_id, college_id, assigned_by)
    values ((select auth.uid()), v_id, (select auth.uid()));
  end if;

  return v_id;
end;
$$;
revoke all on function public.onboarding_create_college(text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.onboarding_create_college(text, text, text, text, text, text, text, text, text) to authenticated;
