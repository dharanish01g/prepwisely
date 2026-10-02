import { type FormEvent, useMemo, useState } from "react";
import { ArchiveIcon, ArchiveRestoreIcon, InfoIcon, PencilIcon, PlusIcon, SearchIcon, Trash2Icon } from "lucide-react";
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
import { buildCategoryRows, useCategories } from "@/lib/categories";
import {
  MAX_DURATION,
  MAX_QUESTIONS_PER_TOPIC,
  MAX_TOPICS,
  MIN_DURATION,
  MIN_QUESTIONS_PER_TOPIC,
  type Split,
  splitDifficulty,
  type Test,
  usePoolSizes,
  useCreateTest,
  useSetTestArchived,
  useTests,
  useUpdateTest,
} from "@/lib/tests";

// Tests (superadmin and onboarding managers): the list of tests with search and Show archived; clicking a row opens a
// drawer with the test's topics and difficulty split. "New test" and Edit open the test's own page (a drill-down),
// where the scheduler sets the title, duration and topics; the system picks every question (TESTS.md 1.1-1.6).
// Scheduling a test to batches is a separate page (Test schedule).

function StatusBadge({ archived }: { archived: boolean }) {
  return <Badge variant={archived ? "secondary" : "default"}>{archived ? "archived" : "active"}</Badge>;
}

const totalQuestions = (test: Test) => test.topics.reduce((sum, t) => sum + t.question_count, 0);

/** Category id -> "Parent › Child", retired topics included (an existing test may still use one). */
function useTopicLabels() {
  const { data: categories = [] } = useCategories();
  return useMemo(() => new Map(buildCategoryRows(categories).map((r) => [r.category.id, r.path])), [categories]);
}

/** Which page is open: the list, or a test's form (null id = a new test). */
type Editing = { testId: string | null } | null;

export function TestsScreen() {
  const tests = useTests();
  const labels = useTopicLabels();
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const editingTest = editing?.testId ? tests.data?.find((t) => t.id === editing.testId) : undefined;

  useSetBreadcrumbTrail(
    editing
      ? {
          items: editingTest ? [{ label: editingTest.title }, { label: "Edit" }] : [{ label: "New test" }],
          onRoot: () => setEditing(null),
        }
      : null,
    editing ? (editingTest ? `${editingTest.id}/${editingTest.title}/edit` : "new") : "",
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (tests.data ?? []).filter((t) => {
      if (!showArchived && t.archived_at) return false;
      return !q || t.title.toLowerCase().includes(q) || t.topics.some((topic) => labels.get(topic.category_id)?.toLowerCase().includes(q));
    });
  }, [tests.data, query, showArchived, labels]);

  function openEditor(testId: string | null) {
    setOpenId(null);
    setEditing({ testId });
  }

  if (editing && (editing.testId === null || editingTest)) {
    return <TestFormPage key={editing.testId ?? "new"} test={editingTest ?? null} onDone={() => setEditing(null)} />;
  }

  const open = openId ? tests.data?.find((t) => t.id === openId) : undefined;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Tests</h1>
          <p className="text-sm text-muted-foreground">
            Set the topics and how many questions each one has. The system picks every question, a different set for each student.
          </p>
        </div>
        <div className="flex gap-2">
          <RefreshButton onRefresh={() => void tests.refetch()} refreshing={tests.isFetching} />
          <Button size="sm" onClick={() => openEditor(null)}>
            <PlusIcon />
            New test
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="relative w-72">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search by title or topic" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
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
              <TableHead>Topics</TableHead>
              <TableHead className="w-24">Questions</TableHead>
              <TableHead className="w-24">Duration</TableHead>
              <TableHead className="w-28">Created</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tests.isPending ? (
              <TableSkeletonRows columns={["w-32", "w-56", "w-8", "w-14", "w-20", "w-14", "w-16 ml-auto"]} />
            ) : tests.error || visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className={`h-24 text-center ${tests.error ? "text-destructive" : "text-muted-foreground"}`}>
                  {tests.error
                    ? `Could not load tests: ${tests.error.message}`
                    : query.trim()
                      ? "No tests match."
                      : tests.data?.length
                        ? "All tests are archived. Turn on Show archived to see them."
                        : "No tests yet. Create one to get started."}
                </TableCell>
              </TableRow>
            ) : (
              visible.map((t) => {
                const archived = t.archived_at !== null;
                return (
                  <TableRow key={t.id} className="cursor-pointer" onClick={() => setOpenId(t.id)}>
                    <TableCell className="max-w-56 truncate font-medium">{t.title}</TableCell>
                    <TableCell className="max-w-80 truncate text-muted-foreground">
                      {t.topics.map((topic) => labels.get(topic.category_id) ?? "—").join(", ")}
                    </TableCell>
                    <TableCell>{totalQuestions(t)}</TableCell>
                    <TableCell>{t.duration_minutes} min</TableCell>
                    <TableCell>{new Date(t.created_at).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <StatusBadge archived={archived} />
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title={archived ? "Restore it to edit" : "Edit"}
                          aria-label={`Edit ${t.title}`}
                          disabled={archived}
                          onClick={() => openEditor(t.id)}
                        >
                          <PencilIcon />
                        </Button>
                        <ArchiveButton test={t} />
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
          {open && <TestDetails test={open} labels={labels} onEdit={() => openEditor(open.id)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function useArchiveToggle(test: Test) {
  const setArchived = useSetTestArchived();
  const archived = test.archived_at !== null;
  function toggle() {
    setArchived.mutate(
      { id: test.id, archived: !archived },
      {
        onSuccess: () => toast.success(archived ? `Restored ${test.title}.` : `Archived ${test.title}.`),
        onError: (err) => toast.error(err.message),
      },
    );
  }
  return { archived, toggle, pending: setArchived.isPending };
}

function ArchiveButton({ test }: { test: Test }) {
  const { archived, toggle, pending } = useArchiveToggle(test);
  const label = archived ? "Restore" : "Archive";
  return (
    <Button variant="ghost" size="icon-sm" title={label} aria-label={`${label} ${test.title}`} disabled={pending} onClick={toggle}>
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

/** Drawer: one test's settings and topics, with edit and archive/restore. */
function TestDetails({ test, labels, onEdit }: { test: Test; labels: Map<string, string>; onEdit: () => void }) {
  const { archived, toggle, pending } = useArchiveToggle(test);

  return (
    <div className="flex flex-1 flex-col gap-5">
      <SheetHeader>
        <SheetTitle className="text-lg font-semibold break-words">{test.title}</SheetTitle>
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
          <Field label="Duration" value={`${test.duration_minutes} minutes`} />
          <Field label="Questions" value={String(totalQuestions(test))} />
          <Field label="Created on" value={new Date(test.created_at).toLocaleDateString()} />
          <Field label="Last changed" value={new Date(test.updated_at).toLocaleDateString()} />
        </div>

        <div className="grid gap-2">
          <p className="text-sm font-medium">Topics</p>
          <div className="border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Topic</TableHead>
                  <TableHead className="w-16 text-right">Total</TableHead>
                  <TableHead className="w-14 text-right">Hard</TableHead>
                  <TableHead className="w-16 text-right">Medium</TableHead>
                  <TableHead className="w-14 text-right">Easy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {test.topics.map((t) => (
                  <TableRow key={t.category_id}>
                    <TableCell className="max-w-40 truncate">{labels.get(t.category_id) ?? "—"}</TableCell>
                    <TableCell className="text-right">{t.question_count}</TableCell>
                    <TableCell className="text-right">{t.hard_count}</TableCell>
                    <TableCell className="text-right">{t.medium_count}</TableCell>
                    <TableCell className="text-right">{t.easy_count}</TableCell>
                  </TableRow>
                ))}
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
// The test's page: create or edit
// ---------------------------------------------------------------------------------------------------------------

interface TopicRow {
  key: number;
  categoryId: string;
  count: string;
}

let nextRowKey = 0;
const newRow = (categoryId = "", count = String(MIN_QUESTIONS_PER_TOPIC)): TopicRow => ({ key: nextRowKey++, categoryId, count });

/** "" (or anything not a number) becomes NaN, so validation reports it instead of treating it as 0. */
const toNumber = (value: string) => (value.trim() === "" ? Number.NaN : Number(value));

function TestFormPage({ test, onDone }: { test: Test | null; onDone: () => void }) {
  const { data: categories = [], isPending: categoriesPending } = useCategories();
  const create = useCreateTest();
  const update = useUpdateTest();
  const busy = create.isPending || update.isPending;

  const [title, setTitle] = useState(test?.title ?? "");
  const [duration, setDuration] = useState(String(test?.duration_minutes ?? 60));
  const [rows, setRows] = useState<TopicRow[]>(() =>
    test ? test.topics.map((t) => newRow(t.category_id, String(t.question_count))) : [newRow()],
  );
  const [error, setError] = useState<string | null>(null);

  const categoryRows = useMemo(() => buildCategoryRows(categories), [categories]);
  // Active topics, plus any retired one this test already uses (so its row still shows a name; saving then explains).
  const topicItems = useMemo(
    () =>
      categoryRows
        .filter((r) => r.category.is_active || rows.some((row) => row.categoryId === r.category.id))
        .map((r) => ({ value: r.category.id, label: r.category.is_active ? r.path : `${r.path} (retired)` })),
    [categoryRows, rows],
  );

  const pickedIds = useMemo(() => [...new Set(rows.map((r) => r.categoryId).filter(Boolean))], [rows]);
  const pools = usePoolSizes(pickedIds);

  function updateRow(key: number, patch: Partial<TopicRow>) {
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const input = {
      title,
      duration_minutes: toNumber(duration),
      topics: rows.map((r) => ({ category_id: r.categoryId, question_count: toNumber(r.count) })),
    };
    try {
      if (test) {
        await update.mutateAsync({ id: test.id, input });
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

  const total = rows.reduce((sum, r) => sum + (Number.isInteger(toNumber(r.count)) ? toNumber(r.count) : 0), 0);

  return (
    <form noValidate onSubmit={handleSubmit} className="flex max-w-4xl flex-1 flex-col gap-5 p-4 pt-0">
      <div>
        <h1 className="text-2xl font-semibold">{test ? "Edit test" : "New test"}</h1>
        <p className="text-sm text-muted-foreground">
          Each topic gets {MIN_QUESTIONS_PER_TOPIC} to {MAX_QUESTIONS_PER_TOPIC} questions, split 50% hard, 30% medium and 20% easy.
          A topic includes its subtopics. Only approved questions are used.
        </p>
      </div>

      <fieldset disabled={busy} className="contents">
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <div className="grid gap-1.5">
            <Label htmlFor="test_title">Title</Label>
            <Input id="test_title" placeholder="e.g. Aptitude 12" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="test_duration">Duration (minutes)</Label>
            <Input
              id="test_duration"
              type="number"
              inputMode="numeric"
              min={MIN_DURATION}
              max={MAX_DURATION}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </div>
        </div>
        <p className="-mt-3 text-xs text-muted-foreground">
          Duration is {MIN_DURATION} to {MAX_DURATION} minutes. The date and start time are set when the test is scheduled.
        </p>

        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Topics</h2>
            <p className="text-xs text-muted-foreground">{total} questions in total</p>
          </div>
          <div className="border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Topic</TableHead>
                  <TableHead className="w-28">Questions</TableHead>
                  <TableHead className="w-28">Hard</TableHead>
                  <TableHead className="w-28">Medium</TableHead>
                  <TableHead className="w-28">Easy</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => {
                  const count = toNumber(row.count);
                  const split =
                    Number.isInteger(count) && count >= MIN_QUESTIONS_PER_TOPIC && count <= MAX_QUESTIONS_PER_TOPIC ? splitDifficulty(count) : null;
                  const pool = row.categoryId ? pools.data?.get(row.categoryId) : undefined;
                  return (
                    <TableRow key={row.key}>
                      <TableCell>
                        <Select
                          value={row.categoryId || null}
                          onValueChange={(v) => updateRow(row.key, { categoryId: v ?? "" })}
                          items={topicItems}
                          disabled={busy || categoriesPending}
                        >
                          <SelectTrigger className="w-full" aria-label={`Topic ${index + 1}`}>
                            <SelectValue placeholder="Select a topic" />
                          </SelectTrigger>
                          <SelectContent>
                            {topicItems.map((c) => (
                              <SelectItem key={c.value} value={c.value} disabled={rows.some((r) => r.key !== row.key && r.categoryId === c.value)}>
                                {c.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={MIN_QUESTIONS_PER_TOPIC}
                          max={MAX_QUESTIONS_PER_TOPIC}
                          aria-label={`Questions for topic ${index + 1}`}
                          value={row.count}
                          onChange={(e) => updateRow(row.key, { count: e.target.value })}
                        />
                      </TableCell>
                      <PoolCell need={split?.hard} have={pool?.hard} />
                      <PoolCell need={split?.medium} have={pool?.medium} />
                      <PoolCell need={split?.easy} have={pool?.easy} />
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove topic ${index + 1}`}
                          disabled={rows.length <= 1}
                          onClick={() => setRows((list) => list.filter((r) => r.key !== row.key))}
                        >
                          <Trash2Icon />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="outline" size="sm" disabled={rows.length >= MAX_TOPICS} onClick={() => setRows((list) => [...list, newRow()])}>
              <PlusIcon />
              Add topic
            </Button>
            <p className="text-xs text-muted-foreground">Each cell shows questions this test needs / approved questions available.</p>
          </div>
          {pools.error && <PoolNotice text={pools.error.message} />}
          <ShortPoolsNotice rows={rows} pools={pools.data} labels={topicItems} />
        </div>
      </fieldset>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-2 pb-4">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : test ? "Save changes" : "Create test"}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** "13 / 40": questions needed / available for one difficulty, in red when the pool is too small. */
function PoolCell({ need, have }: { need: number | undefined; have: number | undefined }) {
  const short = need !== undefined && have !== undefined && need > have;
  return (
    <TableCell className={short ? "text-destructive" : undefined}>
      {need ?? "—"}
      <span className={short ? undefined : "text-muted-foreground"}> / {have ?? "—"}</span>
    </TableCell>
  );
}

function PoolNotice({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 border p-3 text-xs text-muted-foreground">
      <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

/** Lists every pool that's too small (TESTS.md 1.6): the test can't be saved until it's fixed. */
function ShortPoolsNotice({
  rows,
  pools,
  labels,
}: {
  rows: TopicRow[];
  pools: Map<string, Split> | undefined;
  labels: { value: string; label: string }[];
}) {
  if (!pools) return null;
  const problems: string[] = [];
  for (const row of rows) {
    const count = toNumber(row.count);
    const pool = pools.get(row.categoryId);
    if (!pool || !Number.isInteger(count) || count < MIN_QUESTIONS_PER_TOPIC || count > MAX_QUESTIONS_PER_TOPIC) continue;
    const need = splitDifficulty(count);
    const name = labels.find((l) => l.value === row.categoryId)?.label ?? "This topic";
    for (const level of ["hard", "medium", "easy"] as const) {
      if (need[level] > pool[level]) {
        problems.push(`${name} has only ${pool[level]} ${level} question${pool[level] === 1 ? "" : "s"}; this test needs ${need[level]}.`);
      }
    }
  }
  if (problems.length === 0) return null;
  return (
    <div className="border border-destructive/40 bg-destructive/5 p-3 text-xs">
      <p className="mb-1 font-medium text-destructive">Not enough approved questions</p>
      <ul className="grid gap-0.5 text-muted-foreground">
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <p className="mt-2 text-muted-foreground">Add more approved questions to these topics, or lower their counts.</p>
    </div>
  );
}
