-- PrepCode Practice: pc_code_submissions becomes pc_code_events, recording everything a student does on a coding
-- question, not only Submits: opening it, picking a language, each Run and each Submit. Never the code itself, which
-- goes to the student's GitHub repo. pc_code_submissions had no rows yet.
--
-- kind     language                  outcome                       examples_passed / examples_total / passed
-- open     the language shown, if    -                             -
--          any is installed
-- language the one picked            -                             -
-- run      the one run               ran / compile_failed /        ran: the counts, passed = all of them
-- submit                             stopped                       compile_failed: 0 of them; stopped: -
-- A solve recorded before tracking began arrives as a submit with no outcome or counts, passed.
--
-- Solved = a submit that passed. As before, it's worked out on the student's computer, so the database can't check it.

do $$
begin
  if exists (select 1 from public.pc_code_submissions) then
    raise exception 'pc_code_submissions has rows; this migration assumed it was empty';
  end if;
end;
$$;

alter table public.pc_code_submissions rename to pc_code_events;

alter table public.pc_code_events rename constraint pc_code_submissions_pkey to pc_code_events_pkey;
alter table public.pc_code_events rename constraint pc_code_submissions_user_id_fkey to pc_code_events_user_id_fkey;
alter table public.pc_code_events rename constraint pc_code_submissions_question_id_fkey to pc_code_events_question_id_fkey;
alter table public.pc_code_events rename constraint pc_code_submissions_language_check to pc_code_events_language_check;
alter table public.pc_code_events rename constraint pc_code_submissions_examples_passed_check to pc_code_events_examples_passed_check;
alter table public.pc_code_events rename constraint pc_code_submissions_examples_total_check to pc_code_events_examples_total_check;
alter index public.pc_code_submissions_user_question_idx rename to pc_code_events_user_question_idx;
alter index public.pc_code_submissions_question_idx rename to pc_code_events_question_idx;
alter index public.pc_code_submissions_at_idx rename to pc_code_events_at_idx;

alter table public.pc_code_events drop constraint pc_code_submissions_counts;
alter table public.pc_code_events
  add column kind text not null check (kind in ('open', 'language', 'run', 'submit')),
  add column outcome text check (outcome in ('ran', 'compile_failed', 'stopped')),
  alter column language drop not null,
  alter column passed drop not null;

-- See the table above. coalesce: a check that comes out null would otherwise pass.
alter table public.pc_code_events add constraint pc_code_events_fields check (coalesce(
  case
    when kind = 'open' then
      outcome is null and passed is null and examples_passed is null and examples_total is null
    when kind = 'language' then
      language is not null and outcome is null and passed is null and examples_passed is null and examples_total is null
    else
      language is not null and (
        (outcome = 'stopped' and passed is null and examples_passed is null and examples_total is null)
        or (outcome in ('ran', 'compile_failed')
            and examples_passed is not null and examples_total is not null and passed is not null
            and examples_passed <= examples_total
            and passed = (examples_passed = examples_total)
            and (outcome = 'ran' or examples_passed = 0))
        or (kind = 'submit' and outcome is null and passed
            and examples_passed is null and examples_total is null)
      )
  end, false));

-- Staff count solves: submits that passed.
create index pc_code_events_solved_idx on public.pc_code_events (question_id, user_id) where kind = 'submit' and passed;

alter function public.pc_code_submissions_check() rename to pc_code_events_check;
alter trigger pc_code_submissions_check on public.pc_code_events rename to pc_code_events_check;

alter policy "students add their own code submissions on open questions" on public.pc_code_events
  rename to "students add their own code events on open questions";
alter policy "students read their own code submissions" on public.pc_code_events
  rename to "students read their own code events";
alter policy "all code submissions readable by practice managers" on public.pc_code_events
  rename to "all code events readable by practice managers";
