-- The signed-in student's own details with their batch, department and college, for the Profile page. Students can
-- read their own `students` row but not batches/departments/colleges (those are staff-only), so this returns just
-- the one joined row for the caller instead of widening those tables' read rules. Empty for anyone else.

create function public.my_student_profile()
returns table (
  full_name text,
  email text,
  phone text,
  roll_number text,
  status text,
  created_at timestamptz,
  batch_code text,
  graduation_year int,
  department_code text,
  department_name text,
  college_code text,
  college_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.full_name, s.email, s.phone, s.roll_number, s.status, s.created_at,
         b.code, b.graduation_year, d.code, d.name, c.code, c.name
  from public.students s
  join public.batches b on b.id = s.batch_id
  join public.departments d on d.id = b.department_id
  join public.colleges c on c.id = s.college_id
  where s.id = (select auth.uid());
$$;
revoke all on function public.my_student_profile() from public, anon;
grant execute on function public.my_student_profile() to authenticated;
