-- Follow-up to create_departments_and_batches, closing gaps found in testing:
-- 1. A college without a city skipped the name-per-city check (NULLs never collide), so city is now required.
-- 2. Repeated inner spaces ("Anna  University") got past the name checks, so names compare with runs of
--    whitespace collapsed, for colleges and departments.
-- 3. Department codes are uppercased on the way in, matching how onboarding_create_college treats college codes.

alter table public.colleges
  alter column city set not null,
  add constraint colleges_city_not_blank check (btrim(city) <> '');

drop index public.colleges_name_city_key;
create unique index colleges_name_city_key on public.colleges (
  lower(regexp_replace(btrim(name), '\s+', ' ', 'g')),
  lower(regexp_replace(btrim(city), '\s+', ' ', 'g'))
);

drop index public.departments_college_name_key;
create unique index departments_college_name_key on public.departments (
  college_id,
  lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
);

create function public.departments_normalize_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.code := upper(btrim(new.code));
  return new;
end;
$$;

create trigger departments_normalize_code
  before insert on public.departments
  for each row execute function public.departments_normalize_code();
