// Saves the last 24 hours of API traffic as hourly summaries (platform_hourly, platform_hourly_errors). POST, no body.
// On the Free plan Supabase keeps request logs for about a day, so this runs every hour (pg_cron) and rewrites those
// 24 hours: a missed run heals itself on the next. Logs are read through the Management API, with the access token in
// the MANAGEMENT_API_TOKEN secret; it's only ever used to read this project's logs.
//   200 { ok: true, hours, services, errors }
//   401 { error }   neither the schedule's secret nor a superadmin
//   502 { error }   the logs couldn't be read
//   503 { error }   MANAGEMENT_API_TOKEN isn't set
// Called by the hourly schedule (x-snapshot-secret header) or by the superadmin ("Update now" on Platform analytics).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const managementToken = Deno.env.get("MANAGEMENT_API_TOKEN") ?? "";
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const fail = (status: number, error: string) => json({ error }, status);

// The most failing endpoints kept per hour.
const ERRORS_PER_HOUR = 20;

const FROM = `
  from edge_logs t
    cross join unnest(t.metadata) as m
    cross join unnest(m.request) as r
    cross join unnest(m.response) as res`;

const SERVICE = `
  case
    when starts_with(r.path, '/rest/') then 'database'
    when starts_with(r.path, '/auth/') then 'auth'
    when starts_with(r.path, '/storage/') then 'storage'
    when starts_with(r.path, '/functions/') then 'functions'
    when starts_with(r.path, '/realtime/') then 'realtime'
    else 'other'
  end`;

const HOURLY_SQL = `
select
  timestamp_trunc(t.timestamp, hour) as hour,
  ${SERVICE} as service,
  count(*) as requests,
  countif(res.status_code >= 400 and res.status_code < 500) as errors_4xx,
  countif(res.status_code >= 500) as errors_5xx,
  sum(coalesce(res.origin_time, 0)) as total_ms,
  max(coalesce(res.origin_time, 0)) as max_ms,
  sum(coalesce(safe_cast(h.content_length as int64), 0)) as bytes
${FROM}
  left join unnest(res.headers) as h
group by hour, service`;

const ERRORS_SQL = `
select
  timestamp_trunc(t.timestamp, hour) as hour,
  r.method as method,
  r.path as path,
  res.status_code as status,
  count(*) as requests
${FROM}
where res.status_code >= 400
group by hour, method, path, status
order by requests desc
limit 1000`;

type Row = Record<string, unknown>;

/** Runs a logs query over [start, end) through the Management API. */
async function queryLogs(sql: string, start: Date, end: Date): Promise<Row[]> {
  const url = new URL(`https://api.supabase.com/v1/projects/${projectRef}/analytics/endpoints/logs.all`);
  url.searchParams.set("sql", sql);
  url.searchParams.set("iso_timestamp_start", start.toISOString());
  url.searchParams.set("iso_timestamp_end", end.toISOString());
  const response = await fetch(url, { headers: { Authorization: `Bearer ${managementToken}` } });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.error) {
    const reason = body?.error?.message ?? body?.error ?? body?.message ?? response.statusText;
    throw new Error(`Logs query failed (${response.status}): ${typeof reason === "string" ? reason : JSON.stringify(reason)}`);
  }
  return (body.result ?? []) as Row[];
}

/** An hour as the logs return it (microseconds since the epoch, or a timestamp string), as an ISO string. */
function toHour(value: unknown): string {
  const date = typeof value === "number" ? new Date(value / 1000) : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error(`Unexpected hour from the logs: ${JSON.stringify(value)}`);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

const int = (value: unknown) => Math.round(Number(value) || 0);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail(405, "Method not allowed");

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // The schedule's secret, or a signed-in superadmin.
  const secret = req.headers.get("x-snapshot-secret");
  let allowed = false;
  if (secret) {
    const { data } = await admin.rpc("platform_snapshot_secret_ok", { p_secret: secret });
    allowed = data === true;
  } else {
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
      const { data } = await userClient.rpc("is_superadmin");
      allowed = data === true;
    }
  }
  if (!allowed) return fail(401, "Not allowed");
  if (!managementToken) return fail(503, "Not set up yet: the MANAGEMENT_API_TOKEN secret is missing");

  // The 24 hours up to now, starting on the hour (the logs API reads at most 24 hours at a time).
  const end = new Date();
  const start = new Date(end.getTime() - 23 * 3600_000);
  start.setUTCMinutes(0, 0, 0);

  let hourly: Row[];
  let errors: Row[];
  try {
    [hourly, errors] = await Promise.all([queryLogs(HOURLY_SQL, start, end), queryLogs(ERRORS_SQL, start, end)]);
  } catch (e) {
    return fail(502, e instanceof Error ? e.message : String(e));
  }

  const serviceRows = hourly.map((r) => ({
    hour: toHour(r.hour),
    service: String(r.service),
    requests: int(r.requests),
    errors_4xx: int(r.errors_4xx),
    errors_5xx: int(r.errors_5xx),
    total_ms: int(r.total_ms),
    max_ms: int(r.max_ms),
    bytes: int(r.bytes),
    updated_at: end.toISOString(),
  }));

  // Paths that differ only in their query string count as one; then keep each hour's ERRORS_PER_HOUR most failing.
  const merged = new Map<string, { hour: string; method: string; path: string; status: number; requests: number }>();
  for (const r of errors) {
    const row = {
      hour: toHour(r.hour),
      method: String(r.method ?? ""),
      path: String(r.path ?? "").split("?")[0],
      status: int(r.status),
      requests: int(r.requests),
    };
    const key = `${row.hour} ${row.method} ${row.path} ${row.status}`;
    const existing = merged.get(key);
    if (existing) existing.requests += row.requests;
    else merged.set(key, row);
  }
  const perHour = new Map<string, number>();
  const errorRows = [];
  for (const row of [...merged.values()].sort((a, b) => b.requests - a.requests)) {
    const kept = perHour.get(row.hour) ?? 0;
    if (kept >= ERRORS_PER_HOUR) continue;
    perHour.set(row.hour, kept + 1);
    errorRows.push(row);
  }

  // Rewrite the window: an hour with no traffic now has no rows.
  for (const table of ["platform_hourly", "platform_hourly_errors"]) {
    const { error } = await admin.from(table).delete().gte("hour", start.toISOString());
    if (error) return fail(500, `Could not clear ${table}: ${error.message}`);
  }
  if (serviceRows.length) {
    const { error } = await admin.from("platform_hourly").insert(serviceRows);
    if (error) return fail(500, `Could not save the hourly traffic: ${error.message}`);
  }
  if (errorRows.length) {
    const { error } = await admin.from("platform_hourly_errors").insert(errorRows);
    if (error) return fail(500, `Could not save the failing endpoints: ${error.message}`);
  }

  return json({ ok: true, hours: new Set(serviceRows.map((r) => r.hour)).size, services: serviceRows.length, errors: errorRows.length });
});
