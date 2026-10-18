import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { FilterSelect } from "@/components/filter-select";
import { RefreshButton } from "@/components/refresh-button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { indiaToday, METHOD_LABELS, summarize, useUserStats, type UserStats, type UserStatsRow } from "@/lib/user-stats";

const SOURCE_ITEMS = [
  { value: "all", label: "All accounts" },
  { value: "signed_up", label: "PrepCode sign-ups" },
  { value: "added", label: "Added in prepwisely" },
];

const percent = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "–");

/** Superadmin's Overview: sign-ups, how people signed up, and who came back. */
export function OverviewScreen() {
  const stats = useUserStats();
  const [source, setSource] = useState("all");

  const today = indiaToday();
  const rows = useMemo(
    () => (stats.data ?? []).filter((r) => source === "all" || r.source === source),
    [stats.data, source],
  );
  const summary = useMemo(() => summarize(rows, today), [rows, today]);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Overview</h1>
          <p className="text-sm text-muted-foreground">
            Sign-ups across PrepCode and prepwisely, how people signed up, and who came back. Days are India days.
          </p>
        </div>
        <div className="flex gap-2">
          <FilterSelect aria-label="Accounts" value={source} items={SOURCE_ITEMS} onChange={setSource} className="w-52" />
          <RefreshButton onRefresh={() => void stats.refetch()} refreshing={stats.isFetching} />
        </div>
      </div>

      {stats.isError ? (
        <p className="text-sm text-destructive">Could not load the statistics: {stats.error.message}</p>
      ) : stats.isPending ? (
        <OverviewSkeleton />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              label="Total sign-ups"
              value={summary.total}
              detail={`${summary.newToday} today · ${summary.newWeek} in 7 days · ${summary.newMonth} in 30 days`}
            />
            <StatTile
              label="Active in the last 7 days"
              value={summary.activeWeek}
              detail={`${summary.activeToday} today · ${summary.activeMonth} in 30 days`}
            />
            <StatTile
              label="Came back"
              value={summary.returning}
              detail={`${percent(summary.returning, summary.couldReturn)} of those who signed up before today`}
            />
            <StatTile
              label="Didn't come back"
              value={summary.notReturned}
              detail={
                summary.neverSignedIn
                  ? `Not seen after their first day · ${summary.neverSignedIn} never signed in`
                  : "Not seen after their first day"
              }
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Sign-ups per day" note="Last 30 days" className="lg:col-span-2">
              <DailyChart daily={summary.daily} />
            </Panel>
            <Panel title="Sign-up method">
              <MethodList summary={summary} />
            </Panel>
          </div>

          {source === "all" && <SourceTable rows={stats.data} today={today} />}

          <p className="text-xs text-muted-foreground">
            "Seen" means signed in, or used an app while staying signed in. Only each person's latest visit is known, so
            this shows recent activity, not a day-by-day history.
          </p>
        </>
      )}
    </div>
  );
}

function StatTile({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="flex flex-col gap-1 border p-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-3xl font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </div>
  );
}

function Panel({ title, note, className, children }: { title: string; note?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col gap-4 border p-4 ${className ?? ""}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </div>
      {children}
    </div>
  );
}

function DailyChart({ daily }: { daily: UserStats["daily"] }) {
  const max = Math.max(1, ...daily.map((d) => d.users));
  const label = (day: string) => format(parseISO(day), "d MMM");
  return (
    <div className="flex flex-col gap-1">
      <div className="relative flex h-44 items-end gap-0.5 border-b border-t border-t-border/50">
        <span className="absolute -top-2 right-0 bg-background pl-1 text-[10px] leading-none text-muted-foreground tabular-nums">
          {max}
        </span>
        {daily.map((d) => (
          <Tooltip key={d.day}>
            <TooltipTrigger
              render={<div className="flex h-full flex-1 items-end hover:bg-muted" aria-label={`${label(d.day)}: ${d.users} sign-ups`} />}
            >
              <div className="w-full bg-primary" style={{ height: `${(d.users / max) * 100}%` }} />
            </TooltipTrigger>
            <TooltipContent>
              {format(parseISO(d.day), "EEE d MMM")}: {d.users} {d.users === 1 ? "sign-up" : "sign-ups"}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{label(daily[0].day)}</span>
        <span>{label(daily[Math.floor(daily.length / 2)].day)}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

function MethodList({ summary }: { summary: UserStats }) {
  if (!summary.total) return <p className="text-sm text-muted-foreground">No sign-ups yet.</p>;
  return (
    <ul className="flex flex-col gap-4">
      {summary.methods.map((m) => (
        <li key={m.method} className="flex flex-col gap-1.5">
          <div className="flex justify-between gap-2 text-sm">
            <span>{METHOD_LABELS[m.method] ?? m.method}</span>
            <span className="text-muted-foreground tabular-nums">
              {m.users} · {percent(m.users, summary.total)}
            </span>
          </div>
          <Progress value={(m.users / summary.total) * 100} aria-label={METHOD_LABELS[m.method] ?? m.method} />
        </li>
      ))}
    </ul>
  );
}

/** The same numbers for PrepCode's own sign-ups and the accounts made in prepwisely, side by side. */
function SourceTable({ rows, today }: { rows: UserStatsRow[]; today: string }) {
  const lines = [
    { label: "PrepCode sign-ups", stats: summarize(rows.filter((r) => r.source === "signed_up"), today) },
    { label: "Added in prepwisely", stats: summarize(rows.filter((r) => r.source === "added"), today) },
    { label: "All accounts", stats: summarize(rows, today) },
  ];
  return (
    <div className="border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Accounts</TableHead>
            <TableHead className="w-28 text-right">Total</TableHead>
            <TableHead className="w-28 text-right">New (7 days)</TableHead>
            <TableHead className="w-28 text-right">Active (7 days)</TableHead>
            <TableHead className="w-32 text-right">Came back</TableHead>
            <TableHead className="w-32 text-right">Never signed in</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map(({ label, stats }) => (
            <TableRow key={label}>
              <TableCell className={label === "All accounts" ? "font-medium" : undefined}>{label}</TableCell>
              <TableCell className="text-right tabular-nums">{stats.total}</TableCell>
              <TableCell className="text-right tabular-nums">{stats.newWeek}</TableCell>
              <TableCell className="text-right tabular-nums">{stats.activeWeek}</TableCell>
              <TableCell className="text-right tabular-nums">
                {stats.returning} <span className="text-muted-foreground">({percent(stats.returning, stats.couldReturn)})</span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{stats.neverSignedIn}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-64 lg:col-span-2" />
        <Skeleton className="h-64" />
      </div>
    </>
  );
}
