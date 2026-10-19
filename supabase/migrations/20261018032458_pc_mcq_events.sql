-- PrepCode Practice: what students do on MCQs (practice-mcq.md §6), for their own progress and for staff analytics.
--
-- One row per thing a student does on a question: a submit (the option picked, and whether it was right) or a hint
-- opened (which one). Done, right on the first try, number of tries, hints used and time spent are all worked out
-- from these. Students have no profiles row, so rows point at their sign-in account.
--
-- PrepCode keeps each event on the computer first and sends it when it can, so `at` is when it happened there, and
-- `id` is made by the app: sending the same event twice (a retry after a lost reply) keeps one. Guests have no
-- account, so theirs never leave the computer. Rows are only ever added: no updates, no deletes.

create table public.pc_mcq_events (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  question_id uuid not null references public.pc_questions(id) on delete cascade,
  kind text not null check (kind in ('submit', 'hint')),
  -- A submit's option. If the option is later removed it becomes null, and `correct` still says how it went.
  option_id uuid references public.pc_question_options(id) on delete set null,
  -- Set by the database from the option, never taken from the app.
  correct boolean,
  -- A hint's place in the question's hints, from 0.
  hint_index smallint check (hint_index between 0 and 3),
  -- When it happened on the student's computer (never later than when it arrived).
  at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint pc_mcq_events_fields check (
    (kind = 'submit' and correct is not null and hint_index is null)
    or (kind = 'hint' and option_id is null and correct is null and hint_index is not null)
  )
);

create index pc_mcq_events_user_question_idx on public.pc_mcq_events (user_id, question_id, at);
create index pc_mcq_events_question_idx on public.pc_mcq_events (question_id);
create index pc_mcq_events_option_idx on public.pc_mcq_events (option_id);

-- A submit's option must be one of its question's, and decides `correct`; a hint must exist. A computer clock that's
-- ahead can't date an event in the future.
create function public.pc_mcq_events_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'submit' then
    select o.is_correct into new.correct
    from public.pc_question_options o
    where o.id = new.option_id and o.question_id = new.question_id;
    if not found then
      raise exception 'That option isn''t one of this question''s';
    end if;
  elsif new.hint_index >= (select cardinality(hints) from public.pc_questions where id = new.question_id) then
    raise exception 'This question has no hint %', new.hint_index + 1;
  end if;
  new.at := least(new.at, now());
  return new;
end;
$$;

revoke all on function public.pc_mcq_events_check() from public, anon, authenticated;

create trigger pc_mcq_events_check
  before insert on public.pc_mcq_events
  for each row execute function public.pc_mcq_events_check();

alter table public.pc_mcq_events enable row level security;
-- This project auto-grants full privileges on new tables; revoke, then grant only adding and reading.
revoke all on public.pc_mcq_events from public, anon, authenticated;
grant select, insert on public.pc_mcq_events to authenticated;

create policy "students add their own mcq events on open questions"
  on public.pc_mcq_events for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.pc_question_is_open(question_id)));

create policy "students read their own mcq events"
  on public.pc_mcq_events for select to authenticated
  using (user_id = (select auth.uid()));

create policy "all mcq events readable by practice managers"
  on public.pc_mcq_events for select to authenticated
  using ((select public.pc_can_manage()));
