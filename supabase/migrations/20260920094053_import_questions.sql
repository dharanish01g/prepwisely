-- Bulk import for content creators. All rows are inserted in one transaction: if any row is bad, nothing
-- is imported and the error names the row. Every imported question must be complete (same rules as
-- submitting); p_submit decides whether they go straight to review or stay drafts.
-- Each row: { row?, title, description, category_id, difficulty, options: [{ body, explanation, is_correct }] }
create function public.import_questions(p_rows jsonb, p_submit boolean default false)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row jsonb;
  v_opt jsonb;
  v_idx int := 0;
  v_pos int;
  v_id uuid;
begin
  if not public.has_role('content_creator') then
    raise exception 'Only content creators can import questions' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Expected a list of questions';
  end if;
  if jsonb_array_length(p_rows) = 0 then
    raise exception 'Nothing to import';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'Import at most 500 questions at a time';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_idx := v_idx + 1;
    begin
      insert into public.questions (title, description, category_id, difficulty, created_by)
      values (
        btrim(coalesce(v_row ->> 'title', '')),
        coalesce(v_row ->> 'description', ''),
        (v_row ->> 'category_id')::uuid,
        v_row ->> 'difficulty',
        v_uid
      )
      returning id into v_id;

      v_pos := 0;
      for v_opt in select value from jsonb_array_elements(coalesce(v_row -> 'options', '[]'::jsonb)) loop
        v_pos := v_pos + 1;
        insert into public.question_options (question_id, position, body, explanation, is_correct)
        values (
          v_id,
          v_pos,
          coalesce(v_opt ->> 'body', ''),
          coalesce(v_opt ->> 'explanation', ''),
          coalesce((v_opt ->> 'is_correct')::boolean, false)
        );
      end loop;

      perform public.assert_question_complete(v_id);

      if p_submit then
        update public.questions set status = 'submitted', submitted_at = now() where id = v_id;
      end if;
    exception when others then
      raise exception 'Row %: %', coalesce(v_row ->> 'row', v_idx::text), sqlerrm;
    end;
  end loop;

  return v_idx;
end;
$$;

revoke execute on function public.import_questions(jsonb, boolean) from public, anon;
grant execute on function public.import_questions(jsonb, boolean) to authenticated;
