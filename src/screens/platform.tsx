import { useMemo, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { DownloadCloudIcon } from "lucide-react";
import { toast } from "sonner";
import { BarChart, type Bar } from "@/components/bar-chart";
import { FilterSelect } from "@/components/filter-select";
import { RefreshButton } from "@/components/refresh-button";
import { Panel, StatTile } from "@/components/stats";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  FREE_PLAN,
  formatBytes,
  indiaHour,
  SERVICE_LABELS,
  usePlatformHourly,
  useStorageStats,
  useUpdatePlatformNow,
  type HourlyErrorRow,
  type HourlyRow,
  type StorageStats,
} from "@/lib/platform-stats";

const RANGE_ITEMS = [
  { value: "1", label: "Last 24 hours" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const percent = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : "–");
const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/** Superadmin's Platform analytics: traffic, peak and idle times, errors, speed, bandwidth and storage. */
export function PlatformScreen() {
  const [range, setRange] = useState("7");
  const days = Number(range);
  const traffic = usePlatformHourly(days);
  const storage = useStorageStats();
  const updateNow = useUpdatePlatformNow();

  const rows = traffic.data?.hourly ?? [];
  const lastUpdated = rows.reduce<string | null>((latest, r) => (!latest || r.updated_at > latest ? r.updated_at : latest), null);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Platform analytics</h1>
          <p className="text-sm text-muted-foreground">
            Requests to the backend, errors, speed and storage, for PrepCode and prepwisely together. Traffic is saved every
            hour{lastUpdated ? `; last saved ${formatDistanceToNow(new Date(lastUpdated), { addSuffix: true })}` : ""}.
          </p>
        </div>
        <div className="flex gap-2">
          <FilterSelect aria-label="Range" value={range} items={RANGE_ITEMS} onChange={setRange} />
          <Button
            variant="outline"
            size="sm"
            disabled={updateNow.isPending}
            onClick={() =>
              updateNow.mutate(undefined, {
                onSuccess: () => toast.success("Traffic updated"),
                onError: (e) => toast.error(e.message),
              })
            }
          >
            <DownloadCloudIcon />
            Update now
          </Button>
          <RefreshButton
            onRefresh={() => {
              void traffic.refetch();
              void storage.refetch();
            }}
            refreshing={traffic.isFetching || storage.isFetching}
          />
        </div>
      </div>

      {traffic.isError ? (
        <p className="text-sm text-destructive">Could not load the traffic: {traffic.error.message}</p>
      ) : traffic.isPending ? (
        <PlatformSkeleton />
      ) : rows.length === 0 ? (
        <div className="border p-6 text-sm text-muted-foreground">
          No traffic saved yet. It's saved every hour once the logs can be read; "Update now" saves the last 24 hours, or
          says what's missing.
        </div>
      ) : (
        <TrafficSections rows={rows} errors={traffic.data.errors} days={days} />
      )}

      <h2 className="mt-4 text-lg font-semibold">Storage</h2>
      {storage.isError ? (
        <p className="text-sm text-destructive">Could not load the storage: {storage.error.message}</p>
      ) : storage.isPending ? (
        <Skeleton className="h-48" />
      ) : (
        <StorageSection stats={storage.data} />
      )}
    </div>
  );
}

function TrafficSections({ rows, errors, days }: { rows: HourlyRow[]; errors: HourlyErrorRow[]; days: number }) {
  const totals = useMemo(() => {
    const t = { requests: 0, errors4xx: 0, errors5xx: 0, totalMs: 0, maxMs: 0, bytes: 0 };
    for (const r of rows) {
      t.requests += r.requests;
      t.errors4xx += r.errors_4xx;
      t.errors5xx += r.errors_5xx;
      t.totalMs += r.total_ms;
      t.maxMs = Math.max(t.maxMs, r.max_ms);
      t.bytes += r.bytes;
    }
    return t;
  }, [rows]);
  // A month's worth at this rate, to compare with the plan's monthly bandwidth.
  const covered = new Set(rows.map((r) => r.hour)).size;
  const monthlyBytes = covered ? (totals.bytes / covered) * 24 * 30 : 0;

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Requests" value={totals.requests.toLocaleString()} detail={`${Math.round(totals.requests / Math.max(covered, 1))} an hour on average`} />
        <StatTile
          label="Error rate"
          value={percent(totals.errors4xx + totals.errors5xx, totals.requests)}
          detail={`${totals.errors5xx} server errors (5xx) · ${totals.errors4xx} refused (4xx)`}
        />
        <StatTile
          label="Average response time"
          value={`${totals.requests ? Math.round(totals.totalMs / totals.requests) : 0} ms`}
          detail={`Slowest ${totals.maxMs.toLocaleString()} ms`}
        />
        <StatTile
          label="Bandwidth (estimate)"
          value={formatBytes(totals.bytes)}
          detail={`About ${formatBytes(monthlyBytes)} a month of ${formatBytes(FREE_PLAN.egressBytes)} · an under-count`}
        />
      </div>

      <Panel title="Requests" note={days === 30 ? "Per day" : "Per hour"}>
        <RequestsChart rows={rows} days={days} />
      </Panel>

      <Panel title="Peak and idle times" note="Requests by India hour and weekday">
        <PeakGrid rows={rows} />
      </Panel>

      <ServiceTable rows={rows} />
      <FailingTable errors={errors} />

      <p className="text-xs text-muted-foreground">
        From Supabase's request logs, saved as hourly summaries (the Free plan keeps logs for about a day, so history
        starts when saving did). Hours are clock hours in UTC, so in India time each one starts at half past. Bandwidth
        counts only responses that reported their size, so the real figure is higher: see Supabase's Usage page for it.
      </p>
    </>
  );
}

function RequestsChart({ rows, days }: { rows: HourlyRow[]; days: number }) {
  const bars = useMemo((): Bar[] => {
    // Every hour (or day) in the range, so quiet ones show as gaps.
    const byDay = days === 30;
    const step = byDay ? 86_400_000 : 3_600_000;
    const counts = new Map<number, number>();
    for (const r of rows) {
      const t = new Date(r.hour).getTime();
      const key = byDay ? Math.floor(t / step) * step : t;
      counts.set(key, (counts.get(key) ?? 0) + r.requests);
    }
    const now = Date.now();
    const last = Math.floor(now / step) * step;
    const count = byDay ? 30 : days * 24;
    return Array.from({ length: count }, (_, i) => {
      const key = last - (count - 1 - i) * step;
      const value = counts.get(key) ?? 0;
      const when = format(new Date(key), byDay ? "EEE d MMM" : "EEE d MMM, HH:mm");
      return { key: String(key), value, tooltip: `${when}: ${value.toLocaleString()} requests` };
    });
  }, [rows, days]);
  const label = (bar: Bar) => format(new Date(Number(bar.key)), days === 1 ? "HH:mm" : "d MMM");
  return <BarChart bars={bars} labels={[label(bars[0]), label(bars[Math.floor(bars.length / 2)]), "Now"]} />;
}

/** Requests in each India hour of each weekday: darker is busier. Names the busiest hour and the quiet ones. */
function PeakGrid({ rows }: { rows: HourlyRow[] }) {
  const { cells, byHour, max } = useMemo(() => {
    const cells = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    const byHour = new Array<number>(24).fill(0);
    for (const r of rows) {
      const { day, hour } = indiaHour(r.hour);
      cells[day][hour] += r.requests;
      byHour[hour] += r.requests;
    }
    return { cells, byHour, max: Math.max(1, ...cells.flat()) };
  }, [rows]);
  const busiest = byHour.indexOf(Math.max(...byHour));
  const total = byHour.reduce((a, b) => a + b, 0);
  // Hours with under 2% of the traffic.
  const quiet = byHour.map((n, h) => (n < total * 0.02 ? h : -1)).filter((h) => h >= 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[2.5rem_repeat(24,minmax(0,1fr))] gap-px text-[10px] text-muted-foreground">
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="text-center">
            {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
          </span>
        ))}
        {cells.map((hours, day) => (
          <div key={day} className="contents">
            <span className="leading-6">{WEEKDAYS[day]}</span>
            {hours.map((n, h) => (
              <Tooltip key={h}>
                <TooltipTrigger
                  render={<div className="h-6 bg-muted" aria-label={`${WEEKDAYS[day]} ${hourLabel(h)}: ${n} requests`} />}
                >
                  {n > 0 && <div className="h-full w-full bg-primary" style={{ opacity: 0.15 + 0.85 * (n / max) }} />}
                </TooltipTrigger>
                <TooltipContent>
                  {WEEKDAYS[day]} {hourLabel(h)}: {n.toLocaleString()} requests
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        ))}
      </div>
      <p className="text-sm">
        Busiest: <span className="font-medium">{total ? `${hourLabel(busiest)}–${hourLabel((busiest + 1) % 24)}` : "–"}</span>
        <span className="text-muted-foreground"> · </span>
        Quiet (under 2% of requests):{" "}
        <span className="font-medium">{quiet.length ? hourRanges(quiet) : "no quiet hours"}</span>
      </p>
    </div>
  );
}

/** [0,1,2,5,6] -> "00:00–03:00, 05:00–07:00". */
function hourRanges(hours: number[]) {
  const ranges: string[] = [];
  let start = hours[0];
  for (let i = 1; i <= hours.length; i++) {
    if (i === hours.length || hours[i] !== hours[i - 1] + 1) {
      ranges.push(`${hourLabel(start)}–${hourLabel((hours[i - 1] + 1) % 24)}`);
      start = hours[i];
    }
  }
  return ranges.join(", ");
}

function ServiceTable({ rows }: { rows: HourlyRow[] }) {
  const services = useMemo(() => {
    const map = new Map<string, { requests: number; e4: number; e5: number; ms: number; max: number }>();
    for (const r of rows) {
      const s = map.get(r.service) ?? { requests: 0, e4: 0, e5: 0, ms: 0, max: 0 };
      s.requests += r.requests;
      s.e4 += r.errors_4xx;
      s.e5 += r.errors_5xx;
      s.ms += r.total_ms;
      s.max = Math.max(s.max, r.max_ms);
      map.set(r.service, s);
    }
    return [...map].sort((a, b) => b[1].requests - a[1].requests);
  }, [rows]);
  return (
    <div className="border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Service</TableHead>
            <TableHead className="w-28 text-right">Requests</TableHead>
            <TableHead className="w-28 text-right">5xx</TableHead>
            <TableHead className="w-28 text-right">4xx</TableHead>
            <TableHead className="w-28 text-right">Error rate</TableHead>
            <TableHead className="w-28 text-right">Average</TableHead>
            <TableHead className="w-28 text-right">Slowest</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {services.map(([service, s]) => (
            <TableRow key={service}>
              <TableCell>{SERVICE_LABELS[service] ?? service}</TableCell>
              <TableCell className="text-right tabular-nums">{s.requests.toLocaleString()}</TableCell>
              <TableCell className="text-right tabular-nums">{s.e5}</TableCell>
              <TableCell className="text-right tabular-nums">{s.e4}</TableCell>
              <TableCell className="text-right tabular-nums">{percent(s.e4 + s.e5, s.requests)}</TableCell>
              <TableCell className="text-right tabular-nums">{s.requests ? Math.round(s.ms / s.requests) : 0} ms</TableCell>
              <TableCell className="text-right tabular-nums">{s.max.toLocaleString()} ms</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function FailingTable({ errors }: { errors: HourlyErrorRow[] }) {
  const top = useMemo(() => {
    const map = new Map<string, HourlyErrorRow>();
    for (const e of errors) {
      const key = `${e.method} ${e.path} ${e.status}`;
      const existing = map.get(key);
      if (existing) existing.requests += e.requests;
      else map.set(key, { ...e });
    }
    return [...map.values()].sort((a, b) => b.requests - a.requests).slice(0, 10);
  }, [errors]);
  return (
    <div className="border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Most failing requests</TableHead>
            <TableHead className="w-24">Status</TableHead>
            <TableHead className="w-28 text-right">Times</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {top.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                No failed requests in this range.
              </TableCell>
            </TableRow>
          ) : (
            top.map((e) => (
              <TableRow key={`${e.method} ${e.path} ${e.status}`}>
                <TableCell className="font-mono text-xs">
                  {e.method} {e.path}
                </TableCell>
                <TableCell className={e.status >= 500 ? "text-destructive tabular-nums" : "tabular-nums"}>{e.status}</TableCell>
                <TableCell className="text-right tabular-nums">{e.requests.toLocaleString()}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function StorageSection({ stats }: { stats: StorageStats }) {
  const fileBytes = stats.buckets.reduce((sum, b) => sum + b.bytes, 0);
  const files = stats.buckets.reduce((sum, b) => sum + b.files, 0);
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <UsageBar
          label="Database"
          used={stats.database_bytes}
          limit={FREE_PLAN.databaseBytes}
          detail="Tables, indexes and Postgres's own data"
        />
        <UsageBar
          label="File storage"
          used={fileBytes}
          limit={FREE_PLAN.storageBytes}
          detail={`${files} ${files === 1 ? "file" : "files"} in ${stats.buckets.map((b) => b.bucket).join(", ") || "no buckets"}`}
        />
      </div>
      <div className="border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Largest tables</TableHead>
              <TableHead className="w-28 text-right">Rows</TableHead>
              <TableHead className="w-28 text-right">Size</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stats.tables.map((t) => (
              <TableRow key={t.table}>
                <TableCell className="font-mono text-xs">{t.table}</TableCell>
                <TableCell className="text-right tabular-nums">{t.rows.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">{formatBytes(t.bytes)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function UsageBar({ label, used, limit, detail }: { label: string; used: number; limit: number; detail: string }) {
  return (
    <div className="flex flex-col gap-2 border p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm text-muted-foreground tabular-nums">
          {formatBytes(used)} of {formatBytes(limit)} ({percent(used, limit)})
        </span>
      </div>
      <Progress value={Math.min(100, (used / limit) * 100)} aria-label={`${label} used`} />
      <span className="text-xs text-muted-foreground">{detail} · Free plan limit</span>
    </div>
  );
}

function PlatformSkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </>
  );
}
