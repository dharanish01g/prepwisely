import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { BarChart } from "@/components/bar-chart";
import { FilterSelect } from "@/components/filter-select";
import { Panel, StatTile } from "@/components/stats";
import { RefreshButton } from "@/components/refresh-button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePracticeStats, type PracticeStats } from "@/lib/practice-stats";
import { indiaToday, METHOD_LABELS, summarize, useUserStats, type UserStats, type UserStatsRow } from "@/lib/user-stats";

const SOURCE_ITEMS = [
  { value: "all", label: "All accounts" },
  { value: "signed_up", label: "PrepCode sign-ups" },
  { value: "added", label: "Added in prepwisely" },
];

const percent = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "–");

/** Superadmin's Overview: sign-ups, how people signed up, who came back, and the practice problems solved. */
export function OverviewScreen() {
  const stats = useUserStats();
  const practice = usePracticeStats();
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
            Sign-ups across PrepCode and prepwisely, who came back, and the practice problems solved. Days are India days.
          </p>
        </div>
        <div className="flex gap-2">
          <FilterSelect aria-label="Accounts" value={source} items={SOURCE_ITEMS} onChange={setSource} className="w-52" />
          <RefreshButton
            onRefresh={() => {
              void stats.refetch();
              void practice.refetch();
            }}
            refreshing={stats.isFetching || practice.isFetching}
          />
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
              <DailyChart daily={summary.daily} noun={["sign-up", "sign-ups"]} />
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

      <h2 className="mt-4 text-lg font-semibold">Practice</h2>
      {practice.isError ? (
        <p className="text-sm text-destructive">Could not load the practice statistics: {practice.error.message}</p>
      ) : practice.isPending ? (
        <OverviewSkeleton />
      ) : (
        <PracticeSection stats={practice.data} />
      )}
    </div>
  );
}

/** Problems solved in PrepCode Practice: coding Submits and MCQ answers. */
function PracticeSection({ stats }: { stats: PracticeStats }) {
  const { coding, mcq } = stats;
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Coding problems solved"
          value={coding.solved}
          detail={`By ${coding.solvers} ${coding.solvers === 1 ? "student" : "students"}`}
        />
        <StatTile
          label="Coding Submits"
          value={coding.submits}
          detail={`By ${coding.submitters} ${coding.submitters === 1 ? "student" : "students"}`}
        />
        <StatTile
          label="Passed on the first Submit"
          value={coding.first_try_passed}
          detail={`${percent(coding.first_try_passed, coding.first_tries)} of ${coding.first_tries} questions tried`}
        />
        <StatTile
          label="MCQs answered right"
          value={mcq.solved}
          detail={`By ${mcq.solvers} ${mcq.solvers === 1 ? "student" : "students"} · ${percent(mcq.first_try_correct, mcq.first_tries)} right first time`}
        />
      </div>

      <Panel title="Coding problems solved per day" note="Last 30 days">
        <DailyChart daily={coding.daily} noun={["solve", "solves"]} />
      </Panel>

      <div className="border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Most solved coding questions</TableHead>
              <TableHead className="w-32 text-right">Students solved</TableHead>
              <TableHead className="w-28 text-right">Submits</TableHead>
              <TableHead className="w-40 text-right">Passed first time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {coding.top.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                  No coding problems solved yet.
                </TableCell>
              </TableRow>
            ) : (
              coding.top.map((q) => (
                <TableRow key={q.slug}>
                  <TableCell>{q.title}</TableCell>
                  <TableCell className="text-right tabular-nums">{q.solvers}</TableCell>
                  <TableCell className="text-right tabular-nums">{q.submits}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {q.first_try_passed} <span className="text-muted-foreground">({percent(q.first_try_passed, q.first_tries)})</span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Recorded by PrepCode at each Submit, so no one's GitHub is read. Solved means every example passed (or the MCQ
        was answered right), counted once per student and question. Solves from before PrepCode recorded Submits count
        as solved but not as Submits. Students' numbers appear once they're on the PrepCode version that records them.
      </p>
    </>
  );
}

/** One bar per day; `noun` names what's counted, singular and plural. */
function DailyChart({ daily, noun }: { daily: UserStats["daily"]; noun: [string, string] }) {
  const label = (day: string) => format(parseISO(day), "d MMM");
  return (
    <BarChart
      bars={daily.map((d) => ({
        key: d.day,
        value: d.users,
        tooltip: `${format(parseISO(d.day), "EEE d MMM")}: ${d.users} ${d.users === 1 ? noun[0] : noun[1]}`,
      }))}
      labels={[label(daily[0].day), label(daily[Math.floor(daily.length / 2)].day), "Today"]}
    />
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
