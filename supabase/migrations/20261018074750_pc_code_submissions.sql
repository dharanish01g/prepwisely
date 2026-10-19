-- PrepCode Practice: every Submit on a coding question, for students' progress and for staff statistics.
--
-- A solution itself lives in the student's GitHub repo, but a file there only shows they tried; whether it passed is
-- known only in the app, at Submit. So PrepCode records each Submit here: counting problems solved is then one query,
-- with no reading of anyone's repo. Solved = a Submit that passed every example.
--
-- As with pc_mcq_events, PrepCode keeps each Submit on the computer first and sends it when it can: `at` is when it
-- happened there, and `id` is made by the app, so sending one twice keeps it once. Guests' are never sent. Rows are
-- only ever added. Submits from before this table (the app's local "solved" list) arrive once, as passed, without
-- example counts.
--
-- Passing is worked out on the student's computer (the examples run there), so the database can't check it.

create table public.pc_code_submissions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  question_id uuid not null references public.pc_questions(id) on delete cascade,
  -- The language, by file extension: 'py', 'java', 'c', ...
  language text not null check (language ~ '^[a-z0-9+#]{1,10}$'),
  passed boolean not null,
  -- Examples passed, out of how many. Null for a solve recorded before this table existed.
  examples_passed smallint check (examples_passed >= 0),
  examples_total smallint check (examples_total > 0),
  -- When it happened on the student's computer (never later than when it arrived).
  at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint pc_code_submissions_counts check (
    (examples_passed is null and examples_total is null and passed)
    or (examples_passed <= examples_total and passed = (examples_passed = examples_total))
  )
);

create index pc_code_submissions_user_question_idx on public.pc_code_submissions (user_id, question_id, at);
create index pc_code_submissions_question_idx on public.pc_code_submissions (question_id);
create index pc_code_submissions_at_idx on public.pc_code_submissions (at);

-- A computer clock that's ahead can't date a Submit in the future.
create function public.pc_code_submissions_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.at := least(new.at, now());
  return new;
end;
$$;

revoke all on function public.pc_code_submissions_check() from public, anon, authenticated;

create trigger pc_code_submissions_check
  before insert on public.pc_code_submissions
  for each row execute function public.pc_code_submissions_check();

alter table public.pc_code_submissions enable row level security;
-- This project auto-grants full privileges on new tables; revoke, then grant only adding and reading.
revoke all on public.pc_code_submissions from public, anon, authenticated;
grant select, insert on public.pc_code_submissions to authenticated;

create policy "students add their own code submissions on open questions"
  on public.pc_code_submissions for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.pc_question_is_open(question_id)));

create policy "students read their own code submissions"
  on public.pc_code_submissions for select to authenticated
  using (user_id = (select auth.uid()));

create policy "all code submissions readable by practice managers"
  on public.pc_code_submissions for select to authenticated
  using ((select public.pc_can_manage()));
