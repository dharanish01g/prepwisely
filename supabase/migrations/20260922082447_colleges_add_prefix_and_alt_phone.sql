alter table public.colleges
  add column contact_prefix text check (contact_prefix in ('Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.')),
  add column contact_phone_alt text;

-- Same default-privilege gotcha as the original table: re-narrow the update grant to include the two
-- new columns, since ALTER TABLE ADD COLUMN re-triggers the project's default full-privilege grant.
revoke update on public.colleges from authenticated;
grant update (name, contact_prefix, contact_name, contact_email, contact_phone, contact_phone_alt)
  on public.colleges to authenticated;

-- Adding params changes the signature, so this isn't a true "replace" — drop the old 4-arg version first.
drop function public.onboarding_create_college(text, text, text, text);

create function public.onboarding_create_college(
  p_name text,
  p_contact_name text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_contact_prefix text default null,
  p_contact_phone_alt text default null
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

  insert into public.colleges (name, contact_prefix, contact_name, contact_email, contact_phone, contact_phone_alt, created_by)
  values (p_name, p_contact_prefix, p_contact_name, p_contact_email, p_contact_phone, p_contact_phone_alt, (select auth.uid()))
  returning id into v_id;

  if public.has_role('onboarding_manager') then
    insert into public.onboarding_manager_colleges (manager_id, college_id, assigned_by)
    values ((select auth.uid()), v_id, (select auth.uid()));
  end if;

  return v_id;
end;
$$;
revoke all on function public.onboarding_create_college(text, text, text, text, text, text) from public, anon;
grant execute on function public.onboarding_create_college(text, text, text, text, text, text) to authenticated;
