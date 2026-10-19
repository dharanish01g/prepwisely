-- The largest tables' row counts were Postgres's estimates, which lag for small tables (2 rows showed as 0): count
-- them exactly instead. Only the 8 largest tables are counted.
create or replace function public.superadmin_storage_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tables jsonb := '[]'::jsonb;
  v_table record;
  v_rows bigint;
begin
  if not public.is_superadmin() then
    raise exception 'Only the superadmin can see storage statistics';
  end if;
  for v_table in
    select c.relname, pg_total_relation_size(c.oid) as bytes
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by pg_total_relation_size(c.oid) desc
    limit 8
  loop
    execute format('select count(*) from public.%I', v_table.relname) into v_rows;
    v_tables := v_tables || jsonb_build_object('table', v_table.relname, 'bytes', v_table.bytes, 'rows', v_rows);
  end loop;
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
    'tables', v_tables
  );
end;
$$;
