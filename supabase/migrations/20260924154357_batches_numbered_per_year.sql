-- A batch is a section of one department's intake for one graduation year. Numbering now restarts for each
-- year and the year is part of the code: SEC-CSE-2027-B01, SEC-CSE-2027-B02, SEC-CSE-2028-B01. Because the
-- year is in the code, it's locked after creation (a batch created with the wrong year is archived and
-- recreated). Existing batches are renumbered per year (in their original order) and their codes rebuilt.

alter table public.batches drop constraint batches_department_id_number_key;

with renumbered as (
  select id, row_number() over (partition by department_id, graduation_year order by number) as n
  from public.batches
)
update public.batches b
set number = r.n,
    code = c.code || '-' || d.code || '-' || b.graduation_year || '-B' || lpad(r.n::text, greatest(2, length(r.n::text)), '0')
from renumbered r, public.departments d, public.colleges c
where r.id = b.id and d.id = b.department_id and c.id = b.college_id;

alter table public.batches add constraint batches_department_year_number_key unique (department_id, graduation_year, number);

create or replace function public.batches_assign_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_college_id uuid;
  v_dept_code text;
  v_college_code text;
  v_archived timestamptz;
begin
  select d.college_id, d.code, c.code, d.archived_at
    into v_college_id, v_dept_code, v_college_code, v_archived
  from public.departments d
  join public.colleges c on c.id = d.college_id
  where d.id = new.department_id
  for update of d;

  if not found then
    raise exception 'Department not found';
  end if;
  if v_archived is not null then
    raise exception 'Department is archived';
  end if;

  new.college_id := v_college_id;
  select coalesce(max(b.number), 0) + 1 into new.number
  from public.batches b
  where b.department_id = new.department_id and b.graduation_year = new.graduation_year;
  new.code := v_college_code || '-' || v_dept_code || '-' || new.graduation_year || '-B'
    || lpad(new.number::text, greatest(2, length(new.number::text)), '0');
  return new;
end;
$$;

-- The year is part of the code now, so only archiving is editable.
revoke update on public.batches from authenticated;
grant update (archived_at) on public.batches to authenticated;
