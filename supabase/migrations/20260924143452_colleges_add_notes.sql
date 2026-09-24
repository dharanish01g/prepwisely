-- Optional free-text notes on a college (anything the onboarding team wants to remember about it). Every other
-- college field is required in the app form; this is the one optional field. Editable by whoever can edit the
-- college's details (superadmin, assigned onboarding manager).

alter table public.colleges
  add column notes text check (char_length(notes) <= 2000);

revoke update on public.colleges from authenticated;
grant update (name, contact_prefix, contact_name, contact_email, contact_phone, contact_phone_alt, city, state, address, notes)
  on public.colleges to authenticated;

drop function public.onboarding_create_college(text, text, text, text, text, text, text, text, text, text);

create function public.onboarding_create_college(
  p_name text,
  p_code text,
  p_contact_name text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_contact_prefix text default null,
  p_contact_phone_alt text default null,
  p_city text default null,
  p_state text default null,
  p_address text default null,
  p_notes text default null
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

  insert into public.colleges (name, code, contact_prefix, contact_name, contact_email, contact_phone, contact_phone_alt, city, state, address, notes, created_by)
  values (p_name, upper(btrim(p_code)), p_contact_prefix, p_contact_name, p_contact_email, p_contact_phone, p_contact_phone_alt, p_city, p_state, p_address, nullif(btrim(p_notes), ''), (select auth.uid()))
  returning id into v_id;

  if public.has_role('onboarding_manager') then
    insert into public.onboarding_manager_colleges (manager_id, college_id, assigned_by)
    values ((select auth.uid()), v_id, (select auth.uid()));
  end if;

  return v_id;
end;
$$;
revoke all on function public.onboarding_create_college(text, text, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.onboarding_create_college(text, text, text, text, text, text, text, text, text, text, text) to authenticated;
