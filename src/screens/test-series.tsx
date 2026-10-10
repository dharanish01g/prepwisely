import { type FormEvent, useMemo, useState } from "react";
import { ArchiveIcon, ArchiveRestoreIcon, ArrowDownIcon, ArrowUpIcon, PencilIcon, PlusIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { RefreshButton } from "@/components/refresh-button";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSetBreadcrumbTrail } from "@/hooks/use-breadcrumb";
import { MAX_SERIES_TESTS, type TestSeries, useCreateSeries, useSetSeriesArchived, useTestSeries, useUpdateSeries } from "@/lib/test-series";
import { type Test, useTests } from "@/lib/tests";

// Test series (superadmin and onboarding managers): named, ordered lists of tests for long-running programmes
// (TESTS.md 1.17). The list has search and Show archived; clicking a row opens a drawer with the series' days. "New
// series" and Edit open the series' own page (a drill-down) to set the title and add, order and remove tests.
// Scheduling a series to batches happens on Test schedule.

function StatusBadge({ archived }: { archived: boolean }) {
  return <Badge variant={archived ? "secondary" : "default"}>{archived ? "archived" : "active"}</Badge>;
}

const questionCount = (test: Test) => test.topics.reduce((sum, t) => sum + t.question_count, 0);

/** Which page is open: the list, or a series' form (null id = a new series). */
type Editing = { seriesId: string | null } | null;

export function TestSeriesScreen() {
  const series = useTestSeries();
  const tests = useTests();
  const testById = useMemo(() => new Map((tests.data ?? []).map((t) => [t.id, t])), [tests.data]);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const editingSeries = editing?.seriesId ? series.data?.find((s) => s.id === editing.seriesId) : undefined;

  useSetBreadcrumbTrail(
    editing
      ? {
          items: editingSeries ? [{ label: editingSeries.title }, { label: "Edit" }] : [{ label: "New series" }],
          onRoot: () => setEditing(null),
        }
      : null,
    editing ? (editingSeries ? `${editingSeries.id}/${editingSeries.title}/edit` : "new") : "",
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (series.data ?? []).filter((s) => {
      if (!showArchived && s.archived_at) return false;
      return !q || s.title.toLowerCase().includes(q) || s.test_ids.some((id) => testById.get(id)?.title.toLowerCase().includes(q));
    });
  }, [series.data, query, showArchived, testById]);

  function openEditor(seriesId: string | null) {
    setOpenId(null);
    setEditing({ seriesId });
  }

  if (editing && (editing.seriesId === null || editingSeries)) {
    return (
      <SeriesFormPage
        key={editing.seriesId ?? "new"}
        series={editingSeries ?? null}
        tests={tests.data ?? []}
        testsPending={tests.isPending}
        onDone={() => setEditing(null)}
      />
    );
  }

  const open = openId ? series.data?.find((s) => s.id === openId) : undefined;
  const loading = series.isPending || tests.isPending;
  const loadError = series.error ?? tests.error;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Test series</h1>
          <p className="text-sm text-muted-foreground">
            A series is a set of tests in day order, for long-running programmes. Schedule a whole series, or a single test.
          </p>
        </div>
        <div className="flex gap-2">
          <RefreshButton
            onRefresh={() => {
              void series.refetch();
              void tests.refetch();
            }}
            refreshing={series.isFetching || tests.isFetching}
          />
          <Button size="sm" onClick={() => openEditor(null)}>
            <PlusIcon />
            New series
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="relative w-72">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search by title or test" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="show_archived" checked={showArchived} onCheckedChange={setShowArchived} />
          <Label htmlFor="show_archived" className="font-normal">
            Show archived
          </Label>
        </div>
      </div>

      <div className="border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Tests</TableHead>
              <TableHead className="w-20">Days</TableHead>
              <TableHead className="w-28">Created</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableSkeletonRows columns={["w-32", "w-56", "w-8", "w-20", "w-14", "w-16 ml-auto"]} />
            ) : loadError || visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className={`h-24 text-center ${loadError ? "text-destructive" : "text-muted-foreground"}`}>
                  {loadError
                    ? `Could not load series: ${loadError.message}`
                    : query.trim()
                      ? "No series match."
                      : series.data?.length
                        ? "All series are archived. Turn on Show archived to see them."
                        : "No series yet. Create one to get started."}
                </TableCell>
              </TableRow>
            ) : (
              visible.map((s) => {
                const archived = s.archived_at !== null;
                return (
                  <TableRow key={s.id} className="cursor-pointer" onClick={() => setOpenId(s.id)}>
                    <TableCell className="max-w-56 truncate font-medium">{s.title}</TableCell>
                    <TableCell className="max-w-80 truncate text-muted-foreground">
                      {s.test_ids.map((id) => testById.get(id)?.title ?? "—").join(", ")}
                    </TableCell>
                    <TableCell>{s.test_ids.length}</TableCell>
                    <TableCell>{new Date(s.created_at).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <StatusBadge archived={archived} />
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title={archived ? "Restore it to edit" : "Edit"}
                          aria-label={`Edit ${s.title}`}
                          disabled={archived}
                          onClick={() => openEditor(s.id)}
                        >
                          <PencilIcon />
                        </Button>
                        <ArchiveButton series={s} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet open={open !== undefined} onOpenChange={(next) => !next && setOpenId(null)}>
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          {open && <SeriesDetails series={open} testById={testById} onEdit={() => openEditor(open.id)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function useArchiveToggle(series: TestSeries) {
  const setArchived = useSetSeriesArchived();
  const archived = series.archived_at !== null;
  function toggle() {
    setArchived.mutate(
      { id: series.id, archived: !archived },
      {
        onSuccess: () => toast.success(archived ? `Restored ${series.title}.` : `Archived ${series.title}.`),
        onError: (err) => toast.error(err.message),
      },
    );
  }
  return { archived, toggle, pending: setArchived.isPending };
}

function ArchiveButton({ series }: { series: TestSeries }) {
  const { archived, toggle, pending } = useArchiveToggle(series);
  const label = archived ? "Restore" : "Archive";
  return (
    <Button variant="ghost" size="icon-sm" title={label} aria-label={`${label} ${series.title}`} disabled={pending} onClick={toggle}>
      {archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
    </Button>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm break-words">{value}</p>
    </div>
  );
}

/** Drawer: one series' days, with edit and archive/restore. */
function SeriesDetails({ series, testById, onEdit }: { series: TestSeries; testById: Map<string, Test>; onEdit: () => void }) {
  const { archived, toggle, pending } = useArchiveToggle(series);

  return (
    <div className="flex flex-1 flex-col gap-5">
      <SheetHeader>
        <SheetTitle className="text-lg font-semibold break-words">{series.title}</SheetTitle>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-5 px-4 pb-4">
        <div className="flex items-start justify-between gap-4">
          <StatusBadge archived={archived} />
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" disabled={archived} onClick={onEdit}>
              Edit
            </Button>
            <Button variant="outline" size="sm" disabled={pending} onClick={toggle}>
              {archived ? "Restore" : "Archive"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 border p-4">
          <Field label="Days" value={String(series.test_ids.length)} />
          <Field label="Created on" value={new Date(series.created_at).toLocaleDateString()} />
          <Field label="Last changed" value={new Date(series.updated_at).toLocaleDateString()} />
        </div>

        <div className="grid gap-2">
          <p className="text-sm font-medium">Tests</p>
          <div className="border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Day</TableHead>
                  <TableHead>Test</TableHead>
                  <TableHead className="w-20 text-right">Questions</TableHead>
                  <TableHead className="w-20 text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {series.test_ids.map((id, index) => {
                  const test = testById.get(id);
                  return (
                    <TableRow key={id}>
                      <TableCell>{index + 1}</TableCell>
                      <TableCell className="max-w-48 truncate">
                        {test?.title ?? "—"}
                        {test?.archived_at && <span className="text-muted-foreground"> (archived)</span>}
                      </TableCell>
                      <TableCell className="text-right">{test ? questionCount(test) : "—"}</TableCell>
                      <TableCell className="text-right">{test ? `${test.duration_minutes} min` : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {archived && <p className="text-xs text-muted-foreground">Archived: can't be edited or scheduled. Restore it to use it again.</p>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The series' page: create or edit
// ---------------------------------------------------------------------------------------------------------------

function SeriesFormPage({
  series,
  tests,
  testsPending,
  onDone,
}: {
  series: TestSeries | null;
  tests: Test[];
  testsPending: boolean;
  onDone: () => void;
}) {
  const create = useCreateSeries();
  const update = useUpdateSeries();
  const busy = create.isPending || update.isPending;

  const [title, setTitle] = useState(series?.title ?? "");
  const [testIds, setTestIds] = useState<string[]>(series?.test_ids ?? []);
  const [error, setError] = useState<string | null>(null);

  const testById = useMemo(() => new Map(tests.map((t) => [t.id, t])), [tests]);
  // Tests that can still be added: active and not already in the series (oldest first, so they read like a course).
  const addItems = useMemo(
    () =>
      tests
        .filter((t) => !t.archived_at && !testIds.includes(t.id))
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((t) => ({ value: t.id, label: t.title })),
    [tests, testIds],
  );

  function move(index: number, by: -1 | 1) {
    setTestIds((list) => {
      const next = [...list];
      [next[index], next[index + by]] = [next[index + by], next[index]];
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const input = { title, test_ids: testIds };
    try {
      if (series) {
        await update.mutateAsync({ id: series.id, input });
        toast.success(`Saved ${title.trim()}.`);
      } else {
        await create.mutateAsync(input);
        toast.success(`Created ${title.trim()}.`);
      }
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex max-w-4xl flex-1 flex-col gap-5 p-4 pt-0">
      <div>
        <h1 className="text-2xl font-semibold">{series ? "Edit series" : "New series"}</h1>
        <p className="text-sm text-muted-foreground">
          Add tests in the order students should take them: the first test is Day 1. A test can be in a series only once.
        </p>
      </div>

      <fieldset disabled={busy} className="contents">
        <div className="grid max-w-xl gap-1.5">
          <Label htmlFor="series_title">Title</Label>
          <Input
            id="series_title"
            placeholder="e.g. Placement Prep – 30 days"
            maxLength={100}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Tests</h2>
            <p className="text-xs text-muted-foreground">
              {testIds.length} {testIds.length === 1 ? "day" : "days"}
            </p>
          </div>
          <div className="border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Day</TableHead>
                  <TableHead>Test</TableHead>
                  <TableHead className="w-24">Questions</TableHead>
                  <TableHead className="w-24">Duration</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {testIds.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                      No tests yet. Add one below.
                    </TableCell>
                  </TableRow>
                ) : (
                  testIds.map((id, index) => {
                    const test = testById.get(id);
                    return (
                      <TableRow key={id}>
                        <TableCell>{index + 1}</TableCell>
                        <TableCell className="max-w-72 truncate">
                          {test?.title ?? "—"}
                          {test?.archived_at && <span className="text-destructive"> (archived: remove it or restore the test)</span>}
                        </TableCell>
                        <TableCell>{test ? questionCount(test) : "—"}</TableCell>
                        <TableCell>{test ? `${test.duration_minutes} min` : "—"}</TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              title="Move up"
                              aria-label={`Move day ${index + 1} up`}
                              disabled={index === 0}
                              onClick={() => move(index, -1)}
                            >
                              <ArrowUpIcon />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              title="Move down"
                              aria-label={`Move day ${index + 1} down`}
                              disabled={index === testIds.length - 1}
                              onClick={() => move(index, 1)}
                            >
                              <ArrowDownIcon />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              title="Remove"
                              aria-label={`Remove day ${index + 1}`}
                              onClick={() => setTestIds((list) => list.filter((t) => t !== id))}
                            >
                              <Trash2Icon />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={null}
              onValueChange={(v) => v && setTestIds((list) => [...list, v])}
              items={addItems}
              disabled={busy || testsPending || addItems.length === 0 || testIds.length >= MAX_SERIES_TESTS}
            >
              <SelectTrigger className="w-80" aria-label="Add a test">
                <SelectValue placeholder={addItems.length === 0 && !testsPending ? "No more tests to add" : "Add a test…"} />
              </SelectTrigger>
              <SelectContent>
                {addItems.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Only active tests can be added. Create tests on the Tests page.</p>
          </div>
        </div>
      </fieldset>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-2 pb-4">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : series ? "Save changes" : "Create series"}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
