-- A student's phone is optional: colleges can't be expected to share students' personal numbers. Blank is stored
-- as null (the existing check still rejects a blank string).

alter table public.students alter column phone drop not null;

create or replace function public.college_create_student(
  p_id uuid,
  p_batch_id uuid,
  p_full_name text,
  p_email text,
  p_roll_number text,
  p_phone text,
  p_created_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_college_id uuid;
  v_archived timestamptz;
begin
  select college_id, archived_at into v_college_id, v_archived from public.batches where id = p_batch_id;
  if not found then
    raise exception 'Batch not found';
  end if;
  if v_archived is not null then
    raise exception 'Batch is archived';
  end if;

  insert into public.students (id, college_id, batch_id, full_name, email, roll_number, phone, created_by)
  values (p_id, v_college_id, p_batch_id, btrim(p_full_name), lower(btrim(p_email)), btrim(p_roll_number), nullif(btrim(p_phone), ''), p_created_by);
end;
$$;
