-- PrepCode Practice: AI drafts of coding questions (the practice-ai Edge Function, Gemini).
--
-- pc_ai_generations logs every request (who, which category, what they asked, how it went, tokens used), and its
-- functions enforce the limits, so a stuck button or a leaked session can't drain the Gemini credit:
--   per person:  20 an hour, 100 a day;   everyone together: 500 a day.
-- Rows are written only through the two functions below, as the signed-in practice manager (pc_can_manage).
-- Superadmin and content managers can read the log; nothing is ever updated except a row's own outcome, or deleted.

create table public.pc_ai_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id),
  category_id uuid not null references public.pc_categories(id) on delete restrict,
  prompt text not null check (length(prompt) between 1 and 2000),
  -- started → ok (draft returned), refused (off topic), or failed (Gemini error or a draft that failed the checks).
  status text not null default 'started' check (status in ('started', 'ok', 'refused', 'failed')),
  detail text check (length(detail) <= 500),
  prompt_tokens integer check (prompt_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index pc_ai_generations_user_created_idx on public.pc_ai_generations (user_id, created_at desc);
create index pc_ai_generations_created_idx on public.pc_ai_generations (created_at desc);
create index pc_ai_generations_category_idx on public.pc_ai_generations (category_id);

alter table public.pc_ai_generations enable row level security;
revoke all on public.pc_ai_generations from public, anon, authenticated;
grant select on public.pc_ai_generations to authenticated;

create policy "ai generations readable by practice managers"
  on public.pc_ai_generations for select to authenticated
  using ((select public.pc_can_manage()));

-- Records a request before Gemini is called, and refuses it over a limit. Returns the row's id.
create function public.pc_ai_generation_start(p_category_id uuid, p_prompt text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.pc_can_manage() then
    raise exception 'Only superadmins and content managers can generate questions' using errcode = '42501';
  end if;
  if not exists (select 1 from public.pc_categories where id = p_category_id) then
    raise exception 'Category not found' using errcode = 'P0002';
  end if;
  -- One request at a time per person, so the counts below can't be raced.
  perform pg_advisory_xact_lock(hashtext('pc_ai_generation:' || auth.uid()::text));
  if (select count(*) from public.pc_ai_generations
       where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'AI limit reached: 20 drafts an hour. Try again later.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.pc_ai_generations
       where user_id = auth.uid() and created_at > now() - interval '1 day') >= 100 then
    raise exception 'AI limit reached: 100 drafts a day. Try again tomorrow.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.pc_ai_generations where created_at > now() - interval '1 day') >= 500 then
    raise exception 'AI limit reached for everyone today (500 drafts). Try again tomorrow.' using errcode = 'P0001';
  end if;
  insert into public.pc_ai_generations (category_id, prompt) values (p_category_id, p_prompt) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.pc_ai_generation_start(uuid, text) from public, anon;
grant execute on function public.pc_ai_generation_start(uuid, text) to authenticated;

-- Records how a request went. Only the person who started it, only once.
create function public.pc_ai_generation_finish(
  p_id uuid,
  p_status text,
  p_detail text,
  p_prompt_tokens integer,
  p_output_tokens integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('ok', 'refused', 'failed') then
    raise exception 'Unknown status';
  end if;
  update public.pc_ai_generations
     set status = p_status,
         detail = left(p_detail, 500),
         prompt_tokens = greatest(p_prompt_tokens, 0),
         output_tokens = greatest(p_output_tokens, 0),
         finished_at = now()
   where id = p_id and user_id = auth.uid() and status = 'started';
end;
$$;
revoke all on function public.pc_ai_generation_finish(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.pc_ai_generation_finish(uuid, text, text, integer, integer) to authenticated;
