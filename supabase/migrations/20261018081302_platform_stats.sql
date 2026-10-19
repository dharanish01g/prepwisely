-- Platform analytics for the superadmin: traffic, errors, speed and storage.
--
-- On the Free plan Supabase keeps request logs for about a day, so the `platform-snapshot` Edge Function saves them as
-- hourly summaries here: every hour (pg_cron, below) it reads the last 24 hours of the API gateway's logs and rewrites
-- those hours, so a missed run heals itself. Bandwidth is an estimate: many responses don't report their size.
-- Storage numbers come straight from the database (superadmin_storage_stats).

-- One row per hour (UTC) and service: 'database' (/rest), 'auth', 'storage', 'functions', 'realtime' or 'other'.
create table public.platform_hourly (
  hour timestamptz not null,
  service text not null,
  requests integer not null,
  errors_4xx integer not null,
  errors_5xx integer not null,
  -- Sum of response times, for averages over any range; and the slowest.
  total_ms bigint not null,
  max_ms integer not null,
  -- Response bytes where the response reported its size: an under-count.
  bytes bigint not null,
  updated_at timestamptz not null default now(),
  primary key (hour, service)
);

-- The endpoints that failed most each hour (up to 20), for "what's breaking".
create table public.platform_hourly_errors (
  hour timestamptz not null,
  method text not null,
  -- Without the query string; ids in it are kept as they are.
  path text not null,
  status integer not null,
  requests integer not null,
  primary key (hour, method, path, status)
);

alter table public.platform_hourly enable row level security;
alter table public.platform_hourly_errors enable row level security;
-- This project auto-grants full privileges on new tables; only the superadmin reads, and only the snapshot (service
-- role, which bypasses RLS) writes.
revoke all on public.platform_hourly, public.platform_hourly_errors from public, anon, authenticated;
grant select on public.platform_hourly, public.platform_hourly_errors to authenticated;

create policy "platform hourly readable by superadmin"
  on public.platform_hourly for select to authenticated
  using ((select public.is_superadmin()));

create policy "platform hourly errors readable by superadmin"
  on public.platform_hourly_errors for select to authenticated
  using ((select public.is_superadmin()));

-- Database and file storage used, and the largest tables. Superadmin only.
create function public.superadmin_storage_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Only the superadmin can see storage statistics';
  end if;
  return jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'buckets', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', b.id, 'files', coalesce(o.files, 0), 'bytes', coalesce(o.bytes, 0))
        order by coalesce(o.bytes, 0) desc)
      from storage.buckets b
      left join (
        select bucket_id, count(*) as files, sum((metadata ->> 'size')::bigint) as bytes
        from storage.objects
        group by bucket_id
      ) o on o.bucket_id = b.id
    ), '[]'::jsonb),
    'tables', (
      select jsonb_agg(jsonb_build_object('table', t.relname, 'bytes', t.bytes, 'rows', greatest(t.reltuples, 0)::bigint)
        order by t.bytes desc)
      from (
        select c.relname, c.reltuples, pg_total_relation_size(c.oid) as bytes
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by pg_total_relation_size(c.oid) desc
        limit 8
      ) t
    )
  );
end;
$$;

revoke all on function public.superadmin_storage_stats() from public, anon;
grant execute on function public.superadmin_storage_stats() to authenticated;

-- The hourly schedule calls the snapshot with this secret (kept in Vault); the function checks it here, as the
-- service role.
select vault.create_secret(
  replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  'platform_snapshot_secret',
  'Sent by the hourly pg_cron job to the platform-snapshot Edge Function'
);

create function public.platform_snapshot_secret_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets where name = 'platform_snapshot_secret' and decrypted_secret = p_secret
  );
$$;

revoke all on function public.platform_snapshot_secret_ok(text) from public, anon, authenticated;
grant execute on function public.platform_snapshot_secret_ok(text) to service_role;

create extension if not exists pg_net;

-- Five past every hour, so the last hour's logs have arrived.
select cron.schedule(
  'platform-snapshot',
  '5 * * * *',
  $job$
  select net.http_post(
    url := 'https://gjlynpdgovgyyklamtds.supabase.co/functions/v1/platform-snapshot',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-snapshot-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'platform_snapshot_secret')
    ),
    body := '{}'::jsonb
  );
  $job$
);
