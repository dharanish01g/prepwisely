-- pc_code_submissions is now pc_code_events, which also records opening a question, picking a language and each Run.
-- The statistics still count Submits only; a Submit the student stopped has no result, so it's left out.
-- Otherwise unchanged.

create or replace function public.superadmin_practice_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_result jsonb;
begin
  if not public.is_superadmin() then
    raise exception 'Only the superadmin can see practice statistics';
  end if;

  with code as (
    select s.user_id, s.question_id, s.passed, s.at, s.examples_total is not null as tracked
    from public.pc_code_events s
    where s.kind = 'submit' and s.outcome is distinct from 'stopped'
  ),
  -- Each person's first solve of each question.
  code_solves as (
    select user_id, question_id, min(at) as solved_at
    from code
    where passed
    group by user_id, question_id
  ),
  -- Each person's first tracked Submit of each question, and whether it passed.
  code_first as (
    select distinct on (user_id, question_id) user_id, question_id, passed
    from code
    where tracked
    order by user_id, question_id, at
  ),
  mcq_first as (
    select distinct on (user_id, question_id) user_id, question_id, correct
    from public.pc_mcq_events
    where kind = 'submit'
    order by user_id, question_id, at
  ),
  days as (
    select d::date as day from generate_series(v_today - 29, v_today, interval '1 day') d
  ),
  top as (
    select q.title, q.slug,
      count(distinct cs.user_id) as solvers,
      (select count(*) from code c where c.question_id = q.id and c.tracked) as submits,
      (select count(*) filter (where f.passed) from code_first f where f.question_id = q.id) as first_try_passed,
      (select count(*) from code_first f where f.question_id = q.id) as first_tries
    from public.pc_questions q
    join code_solves cs on cs.question_id = q.id
    group by q.id, q.title, q.slug
    order by solvers desc, q.title
    limit 10
  )
  select jsonb_build_object(
    'coding', jsonb_build_object(
      'solved', (select count(*) from code_solves),
      'solvers', (select count(distinct user_id) from code_solves),
      'submits', (select count(*) from code where tracked),
      'submitters', (select count(distinct user_id) from code where tracked),
      'first_try_passed', (select count(*) from code_first where passed),
      'first_tries', (select count(*) from code_first),
      'daily', (
        select jsonb_agg(jsonb_build_object('day', d.day, 'users', (
          select count(*) from code_solves cs where (cs.solved_at at time zone 'Asia/Kolkata')::date = d.day
        )) order by d.day)
        from days d
      ),
      'top', coalesce((select jsonb_agg(to_jsonb(t) order by t.solvers desc, t.title) from top t), '[]'::jsonb)
    ),
    'mcq', jsonb_build_object(
      'solved', (select count(distinct (user_id, question_id)) from public.pc_mcq_events where kind = 'submit' and correct),
      'solvers', (select count(distinct user_id) from public.pc_mcq_events where kind = 'submit' and correct),
      'answers', (select count(*) from public.pc_mcq_events where kind = 'submit'),
      'first_try_correct', (select count(*) from mcq_first where correct),
      'first_tries', (select count(*) from mcq_first)
    )
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.superadmin_practice_stats() from public, anon;
grant execute on function public.superadmin_practice_stats() to authenticated;

