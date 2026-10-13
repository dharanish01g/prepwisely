import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  CircleAlertIcon,
  LockIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  UploadIcon,
  SearchIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { ImportPracticeQuestionsDialog } from "@/components/import-practice-questions-dialog";
import { LazyCodeEditor } from "@/components/lazy-code-editor";
import { Markdown, MarkdownField } from "@/components/markdown";
import { RefreshButton } from "@/components/refresh-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useSetBreadcrumbTrail } from "@/hooks/use-breadcrumb";
import { type PcCategory, type PcDomain, slugify, usePractice } from "@/lib/practice";
import { applyGenerated, fixExpectedValues, MAX_PROMPT, MIN_PROMPT, useGenerateQuestion } from "@/lib/practice-ai";
import { INSTALL_HINT, type RuntimeStatus, useRuntimes } from "@/lib/runtimes";
import { runSolution as runSolutionOnComputer } from "@/lib/solution-runner";
import {
  usePracticeQuestions,
  useReorderQuestions,
  useSaveQuestion,
  useSetQuestionArchived,
  useSetQuestionPublished,
} from "@/lib/practice-questions-data";
import {
  type Access,
  checkValue,
  DIFFICULTIES,
  type Difficulty,
  emptyQuestion,
  emptyTestCase,
  MIN_EXAMPLES,
  MIN_WORDS,
  nameProblem,
  newId,
  type Param,
  type PracticeQuestion,
  publishChecks,
  type QuestionStatus,
  shownValue,
  type CaseResult,
  type Language,
  LANGUAGES,
  languageLabel,
  runKey,
  writtenLanguages,
  starterCode,
  type TestCase,
  testCaseErrors,
  VALUE_PLACEHOLDER,
  VALUE_TYPES,
  type ValueType,
  type Visibility,
  wordCount,
} from "@/lib/practice-questions";

// PrepCode Practice questions (superadmin and content managers): the coding questions inside each category card.
// A list with filters, and a question opens its own page (a drill-down) with the editor on the left and what the
// student sees on the right. Saved in pc_questions, pc_test_cases and pc_question_solutions (practice-questions-data.ts).

type Item = { value: string; label: string };

const ALL = "all";
/** Every status but archived. */
const ACTIVE = "active";

const STATUS_ITEMS: Item[] = [
  { value: ACTIVE, label: "Draft and published" },
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
];

function FilterSelect({
  id,
  value,
  items,
  onChange,
  className,
  placeholder,
}: {
  id: string;
  value: string;
  items: Item[];
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
}) {
  return (
    <Select value={value || null} onValueChange={(v) => v && onChange(v)} items={items}>
      <SelectTrigger id={id} className={className ?? "w-44"}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function difficultyLabel(d: Difficulty) {
  return DIFFICULTIES.find((x) => x.value === d)?.label ?? d;
}

function StatusBadge({ status }: { status: QuestionStatus }) {
  return <Badge variant={status === "published" ? "default" : status === "archived" ? "secondary" : "outline"}>{status}</Badge>;
}

function AccessBadge({ access }: { access: Access }) {
  return access === "private" ? (
    <Badge variant="outline">
      <LockIcon />
      Private
    </Badge>
  ) : (
    <Badge variant="ghost">Public</Badge>
  );
}

export function PracticeQuestionsScreen() {
  const practice = usePractice();
  const questionsQuery = usePracticeQuestions(practice.data?.categories);
  const questions = useMemo(() => questionsQuery.data ?? [], [questionsQuery.data]);
  const setArchived = useSetQuestionArchived();
  const reorder = useReorderQuestions();
  /** The question being edited, or a new one (not saved yet). */
  const [editing, setEditing] = useState<{ id: string } | { draft: PracticeQuestion } | null>(null);
  const [domainFilter, setDomainFilter] = useState(ALL);
  const [categoryFilter, setCategoryFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ACTIVE);
  const [difficultyFilter, setDifficultyFilter] = useState(ALL);
  const [search, setSearch] = useState("");
  const [picking, setPicking] = useState(false);
  const [importing, setImporting] = useState(false);

  const domains = practice.data?.domains ?? [];
  const categories = practice.data?.categories ?? [];
  const bySlug = useMemo(() => new Map(categories.map((c) => [c.slug, c])), [categories]);
  const domainById = useMemo(() => new Map(domains.map((d) => [d.id, d])), [domains]);

  const editingQuestion = editing && "id" in editing ? questions.find((q) => q.id === editing.id) : undefined;
  const editingTitle = editing ? (editingQuestion ? editingQuestion.title || "Untitled" : "New question") : "";
  const editingCategory = editing ? bySlug.get("id" in editing ? (editingQuestion?.category_slug ?? "") : editing.draft.category_slug) : undefined;

  useSetBreadcrumbTrail(
    editing
      ? {
          items: [...(editingCategory ? [{ label: editingCategory.title }] : []), { label: editingTitle }],
          onRoot: () => setEditing(null),
        }
      : null,
    editing ? `${editingQuestion?.id ?? "new"}/${editingTitle}` : "",
  );

  // Sorted as PrepCode shows them: by domain, then category, then position.
  const sorted = useMemo(() => {
    const rank = (q: PracticeQuestion) => {
      const c = bySlug.get(q.category_slug);
      const d = c ? domainById.get(c.domain_id) : undefined;
      return [d?.position ?? 1e9, c?.position ?? 1e9, q.position];
    };
    return [...questions].sort((a, b) => {
      const [ra, rb] = [rank(a), rank(b)];
      return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
    });
  }, [questions, bySlug, domainById]);

  const visible = sorted.filter((q) => {
    const c = bySlug.get(q.category_slug);
    if (domainFilter !== ALL && c?.domain_id !== domainFilter) return false;
    if (categoryFilter !== ALL && q.category_slug !== categoryFilter) return false;
    if (statusFilter === ACTIVE ? q.status === "archived" : statusFilter !== q.status) return false;
    if (difficultyFilter !== ALL && q.difficulty !== difficultyFilter) return false;
    const s = search.trim().toLowerCase();
    return !s || q.title.toLowerCase().includes(s) || q.slug.includes(s);
  });

  const activeCategories = categories.filter((c) => !c.archived_at && (domainFilter === ALL || c.domain_id === domainFilter));
  const domainItems: Item[] = [{ value: ALL, label: "All domains" }, ...domains.filter((d) => !d.archived_at).map((d) => ({ value: d.id, label: d.title }))];
  const categoryItems: Item[] = [{ value: ALL, label: "All categories" }, ...activeCategories.map((c) => ({ value: c.slug, label: c.title }))];
  const difficultyItems: Item[] = [{ value: ALL, label: "All difficulties" }, ...DIFFICULTIES];

  function toggleArchived(q: PracticeQuestion) {
    const archived = q.status === "archived";
    setArchived.mutate(
      { id: q.id, archived: !archived },
      {
        onSuccess: () => toast.success(archived ? `Restored ${q.title} as a draft.` : `Archived ${q.title}. It's hidden from PrepCode.`),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  /** Swaps with the nearest visible question in the same category, then saves the category's whole order. */
  function move(q: PracticeQuestion, by: -1 | 1) {
    const same = visible.filter((x) => x.category_slug === q.category_slug);
    const other = same[same.indexOf(q) + by];
    const category = bySlug.get(q.category_slug);
    if (!other || !category) return;
    const ids = questions
      .filter((x) => x.category_slug === q.category_slug)
      .sort((a, b) => a.position - b.position)
      .map((x) => (x.id === q.id ? other.id : x.id === other.id ? q.id : x.id));
    reorder.mutate({ categoryId: category.id, ids }, { onError: (err) => toast.error(err.message) });
  }

  if (editing && ("draft" in editing || editingQuestion)) {
    const start = "draft" in editing ? editing.draft : editingQuestion!;
    return (
      <QuestionEditor
        key={start.id}
        initial={start}
        isNew={"draft" in editing}
        domains={domains}
        categories={categories}
        onSaved={(id) => setEditing({ id })}
        onDone={() => setEditing(null)}
      />
    );
  }

  const canMove = categoryFilter !== ALL;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Practice questions</h1>
          <p className="text-sm text-muted-foreground">The coding questions students solve in PrepCode's Practice cards.</p>
        </div>
        <div className="flex gap-2">
          <RefreshButton
            onRefresh={() => {
              void practice.refetch();
              void questionsQuery.refetch();
            }}
            refreshing={practice.isFetching || questionsQuery.isFetching}
          />
          <Button size="sm" variant="outline" disabled={!questionsQuery.data} onClick={() => setImporting(true)}>
            <UploadIcon />
            Import
          </Button>
          <Button size="sm" onClick={() => setPicking(true)}>
            <PlusIcon />
            New question
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          id="pq_domain"
          value={domainFilter}
          items={domainItems}
          onChange={(v) => {
            setDomainFilter(v);
            setCategoryFilter(ALL);
          }}
        />
        <FilterSelect id="pq_category" value={categoryFilter} items={categoryItems} onChange={setCategoryFilter} className="w-52" />
        <FilterSelect id="pq_status" value={statusFilter} items={STATUS_ITEMS} onChange={setStatusFilter} />
        <FilterSelect id="pq_difficulty" value={difficultyFilter} items={difficultyItems} onChange={setDifficultyFilter} className="w-36" />
        <div className="relative w-64">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search title or slug" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" aria-label="Search questions" />
        </div>
      </div>

      <div className="border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="w-24">Difficulty</TableHead>
              <TableHead className="w-24">Access</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-28">Updated</TableHead>
              <TableHead className="w-36" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {questionsQuery.isPending || practice.isPending ? (
              <TableRow>
                <TableCell colSpan={8} className="h-20 text-center text-muted-foreground">
                  Loading questions…
                </TableCell>
              </TableRow>
            ) : questionsQuery.error || practice.error ? (
              <TableRow>
                <TableCell colSpan={8} className="h-20 text-center text-destructive">
                  Could not load questions: {(questionsQuery.error ?? practice.error)?.message}
                </TableCell>
              </TableRow>
            ) : visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-20 text-center text-muted-foreground">
                  {questions.length === 0 ? "No questions yet. Add one with New question." : "No questions match."}
                </TableCell>
              </TableRow>
            ) : (
              visible.map((q) => {
                const c = bySlug.get(q.category_slug);
                const same = visible.filter((x) => x.category_slug === q.category_slug);
                const archived = q.status === "archived";
                return (
                  <TableRow key={q.id} className={cn(!archived && "cursor-pointer")} onClick={() => !archived && setEditing({ id: q.id })}>
                    <TableCell className="text-muted-foreground">{q.position}</TableCell>
                    <TableCell className="max-w-64">
                      <p className="truncate font-medium">{q.title || "Untitled"}</p>
                      <p className="truncate text-xs text-muted-foreground">{q.slug || "no slug"}</p>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c?.title ?? "No category"}</TableCell>
                    <TableCell>{difficultyLabel(q.difficulty)}</TableCell>
                    <TableCell>
                      <AccessBadge access={q.access} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={q.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{new Date(q.updated_at).toLocaleDateString()}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        {canMove && (
                          <>
                            <Button variant="ghost" size="icon-sm" title="Move up" aria-label={`Move ${q.title} up`} disabled={reorder.isPending || same[0] === q} onClick={() => move(q, -1)}>
                              <ArrowUpIcon />
                            </Button>
                            <Button variant="ghost" size="icon-sm" title="Move down" aria-label={`Move ${q.title} down`} disabled={reorder.isPending || same[same.length - 1] === q} onClick={() => move(q, 1)}>
                              <ArrowDownIcon />
                            </Button>
                          </>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title={archived ? "Restore it to edit" : "Edit"}
                          aria-label={`Edit ${q.title}`}
                          disabled={archived}
                          onClick={() => setEditing({ id: q.id })}
                        >
                          <PencilIcon />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title={archived ? "Restore" : "Archive"}
                          aria-label={`${archived ? "Restore" : "Archive"} ${q.title}`}
                          disabled={setArchived.isPending}
                          onClick={() => toggleArchived(q)}
                        >
                          {archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
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
      {!canMove && <p className="text-xs text-muted-foreground">Choose a category to change the order students see.</p>}

      <ImportPracticeQuestionsDialog
        open={importing}
        onOpenChange={setImporting}
        domains={domains}
        categories={categories}
        existingSlugs={new Set(questions.map((q) => q.slug))}
      />

      <CategoryDialog
        open={picking}
        title="New question"
        description="Choose where the question goes. You write its content next."
        action="Create question"
        domains={domains}
        categories={categories}
        initialDomainId={domainFilter !== ALL ? domainFilter : bySlug.get(categoryFilter)?.domain_id}
        initialSlug={categoryFilter !== ALL ? categoryFilter : ""}
        onClose={() => setPicking(false)}
        onPick={(slug) => {
          setPicking(false);
          setEditing({ draft: emptyQuestion(slug, 0) });
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------------------------------------------

function Section({ n, title, aside, children }: { n?: number; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-4 border p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {n !== undefined && <span className="mr-2 text-muted-foreground">{n}</span>}
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Ok({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <span className={cn("text-xs", ok ? "text-muted-foreground" : "text-destructive")}>{children}</span>;
}

function QuestionEditor({
  initial,
  isNew,
  domains,
  categories,
  onSaved,
  onDone,
}: {
  initial: PracticeQuestion;
  isNew: boolean;
  domains: PcDomain[];
  categories: PcCategory[];
  /** After a save; a new question then reopens from the database under its id. */
  onSaved: (id: string) => void;
  onDone: () => void;
}) {
  const [q, setQ] = useState(initial);
  const saveQuestion = useSaveQuestion();
  const setPublished = useSetQuestionPublished();
  const busy = saveQuestion.isPending || setPublished.isPending;
  const [slugEdited, setSlugEdited] = useState(!isNew);
  const [showChecks, setShowChecks] = useState(false);
  const set = (patch: Partial<PracticeQuestion>) => setQ((x) => ({ ...x, ...patch }));

  const published = initial.status === "published";
  const runtimes = useRuntimes();
  const [running, setRunning] = useState(false);
  /** The last compile error per language, with the code it was for (hidden once the code changes). */
  const [compileErrors, setCompileErrors] = useState<Partial<Record<Language, { code: string; text: string }>>>({});
  /** Each language's last run of each case ("python:<case id>"), with what it was run for (see runKey). */
  // Solutions saved as passing count as passed until the code, method or a case changes.
  const [runs, setRuns] = useState<Record<string, { key: string; result: CaseResult }>>(() =>
    Object.fromEntries(
      initial.solutions_passed.flatMap((l) =>
        initial.test_cases.map((t) => [`${l}:${t.id}`, { key: runKey(initial, t, l), result: { status: "passed" } as CaseResult }]),
      ),
    ),
  );
  const language = q.solution_language;
  const code = q.solutions[language] ?? starterCode(q, language);
  const resultIn = (l: Language, t: TestCase) => {
    const run = runs[`${l}:${t.id}`];
    return run?.key === runKey(q, t, l) ? run.result : undefined;
  };
  const passesAllIn = (l: Language) => q.test_cases.length > 0 && q.test_cases.every((t) => resultIn(l, t)?.status === "passed");
  const passed = q.test_cases.filter((t) => resultIn(language, t)?.status === "passed").length;
  const written = writtenLanguages(q);
  const runtime = runtimes.data?.find((r) => r.id === language);

  const passing = LANGUAGES.map((l) => l.id).filter(passesAllIn);
  const checks = publishChecks(q, passing);
  const ready = checks.every((c) => c.ok);
  const words = wordCount(q.description);
  const examples = q.test_cases.filter((t) => t.visibility === "example").length;
  const hidden = q.test_cases.length - examples;

  const [moving, setMoving] = useState(false);
  const category = categories.find((c) => c.slug === q.category_slug);

  // AI draft (new questions only): fills every card below from the author's description; nothing is saved.
  const [prompt, setPrompt] = useState("");
  const generate = useGenerateQuestion();
  const [checkingDraft, setCheckingDraft] = useState(false);
  const generating = generate.isPending || checkingDraft;
  const filled = q.title.trim() !== "" || q.description.trim() !== "";

  async function generateDraft() {
    if (!category) {
      toast.error("Choose a category first.");
      return;
    }
    let next: PracticeQuestion;
    try {
      next = applyGenerated(q, await generate.mutateAsync({ categoryId: category.id, prompt }));
    } catch (err) {
      toast.error((err as Error).message);
      return;
    }
    setSlugEdited(false);
    setCompileErrors({});

    // Expected values come from running the draft's Python solution here, when Python is installed.
    if (!runtimes.data?.find((r) => r.id === "python")?.installed) {
      setQ(next);
      toast.warning("Draft filled in. Python isn't installed here, so the expected values weren't checked: check them by hand.");
      return;
    }
    setCheckingDraft(true);
    try {
      const fix = await fixExpectedValues(next);
      next = fix.question;
      setQ(next);
      if (fix.compileError !== null) {
        setCompileErrors({ python: { code: next.solutions.python ?? "", text: fix.compileError } });
        toast.error("Draft filled in, but its Python solution didn't run, so the expected values weren't checked.");
        return;
      }
      // The cases now match the solution: show them as passed.
      const passedCases = next.test_cases.filter((_, i) => !fix.errors.includes(i + 1));
      setRuns(Object.fromEntries(passedCases.map((t) => [`python:${t.id}`, { key: runKey(next, t, "python"), result: { status: "passed" } as CaseResult }])));
      const parts = [
        fix.corrected.length
          ? `corrected ${fix.corrected.length === 1 ? "the expected value of case" : "the expected values of cases"} ${fix.corrected.join(", ")} from the solution`
          : "every expected value matched the solution",
        fix.errors.length ? `the solution failed on case${fix.errors.length === 1 ? "" : "s"} ${fix.errors.join(", ")}: fix or remove ${fix.errors.length === 1 ? "it" : "them"}` : "",
      ].filter(Boolean);
      const message = `Draft filled in: ${parts.join("; ")}. Check the solution itself before publishing.`;
      if (fix.errors.length) toast.warning(message);
      else toast.success(message);
    } catch (err) {
      setQ(next);
      toast.error(`Draft filled in, but checking it failed: ${(err as Error).message}`);
    } finally {
      setCheckingDraft(false);
    }
  }
  const domain = domains.find((d) => d.id === category?.domain_id);

  /** Saves everything and returns the question's id. */
  async function persist(): Promise<string> {
    const categoryId = categories.find((c) => c.slug === q.category_slug)?.id;
    if (!categoryId) throw new Error("Choose a category first");
    return saveQuestion.mutateAsync({ id: isNew ? null : q.id, categoryId, question: q, passing });
  }

  async function act(work: () => Promise<string>, message: string) {
    try {
      const id = await work();
      toast.success(message);
      onSaved(id);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const name = q.title.trim() || "the question";
    void act(persist, published ? `Saved ${name}.` : `Saved ${name} as a draft.`);
  }

  function publish() {
    if (!ready) {
      setShowChecks(true);
      toast.error("Not ready to publish yet. See the checks.");
      return;
    }
    void act(async () => {
      const id = await persist();
      await setPublished.mutateAsync({ id, published: true });
      return id;
    }, `Published ${q.title.trim()}. PrepCode shows it now.`);
  }

  function unpublish() {
    // Back to draft first, so the save that follows may be incomplete.
    void act(async () => {
      await setPublished.mutateAsync({ id: q.id, published: false });
      return persist();
    }, `Moved ${q.title.trim()} back to draft. It's hidden from PrepCode.`);
  }

  // Parameters
  function setParam(id: string, patch: Partial<Param>) {
    set({ params: q.params.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  }
  function addParam() {
    const p: Param = { id: newId(), name: "", type: "int" };
    set({ params: [...q.params, p], test_cases: q.test_cases.map((t) => ({ ...t, inputs: { ...t.inputs, [p.id]: "" } })) });
  }
  function removeParam(id: string) {
    set({ params: q.params.filter((p) => p.id !== id) });
  }

  // Solution
  /** Compiles and runs the selected language's solution against every test case, on this computer. */
  async function runSolution() {
    if (!written.includes(language)) {
      toast.error(`Write the ${languageLabel(language)} solution first.`);
      return;
    }
    if (nameProblem(q.method)) {
      toast.error("Give the method a valid name first.");
      return;
    }
    if (q.test_cases.length === 0) {
      toast.error("Add test cases to run it against.");
      return;
    }
    const snapshot = q;
    setRunning(true);
    setCompileErrors(({ [language]: _old, ...rest }) => rest);
    try {
      const run = await runSolutionOnComputer(snapshot, language);
      if (run.compileError !== null) {
        setCompileErrors((old) => ({ ...old, [language]: { code: snapshot.solutions[language] ?? "", text: run.compileError ?? "" } }));
      }
      setRuns((old) => ({
        ...old,
        ...Object.fromEntries(
          Object.entries(run.results).map(([id, result]) => {
            const t = snapshot.test_cases.find((x) => x.id === id)!;
            return [`${language}:${id}`, { key: runKey(snapshot, t, language), result }];
          }),
        ),
      }));
      const results = Object.values(run.results);
      const passedNow = results.filter((r) => r.status === "passed").length;
      if (run.compileError !== null) toast.error(`The ${languageLabel(language)} solution didn't compile.`);
      else if (passedNow === snapshot.test_cases.length) toast.success(`${languageLabel(language)} passes all ${passedNow} test cases.`);
      else toast.error(`${languageLabel(language)} passes ${passedNow} of ${snapshot.test_cases.length} test cases.`);
    } catch (err) {
      toast.error((err as Error).message ?? String(err));
    } finally {
      setRunning(false);
    }
  }

  // Test cases
  function setCase(id: string, patch: Partial<TestCase>) {
    set({ test_cases: q.test_cases.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  }
  function moveCase(index: number, by: -1 | 1) {
    const cases = [...q.test_cases];
    [cases[index], cases[index + by]] = [cases[index + by], cases[index]];
    set({ test_cases: cases });
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{isNew ? "New question" : q.title || "Untitled"}</h1>
            <StatusBadge status={initial.status} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>
              {domain?.title ?? "No domain"} › <span className="text-foreground">{category?.title ?? "No category"}</span>
            </span>
            <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={() => setMoving(true)}>
              Change
            </Button>
            {!isNew && q.category_slug !== initial.category_slug && <span className="text-xs">Saving puts it last in the new category.</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onDone}>
            Back to list
          </Button>
          {published ? (
            <>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={unpublish}>
                Move to draft
              </Button>
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? "Saving…" : "Save changes"}
              </Button>
            </>
          ) : (
            <>
              <Button type="submit" variant="outline" size="sm" disabled={busy}>
                {saveQuestion.isPending && !setPublished.isPending ? "Saving…" : "Save draft"}
              </Button>
              <Button type="button" size="sm" disabled={busy} onClick={publish}>
                Publish
              </Button>
            </>
          )}
        </div>
      </div>

      {(showChecks || published) && !ready && <ChecksPanel checks={checks} />}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="grid min-w-0 content-start gap-4">
          {isNew && (
            <Section title="Describe the question" aside={<span className="text-xs text-muted-foreground">Drafted with AI</span>}>
              <div className="grid gap-1.5">
                <Label htmlFor="pq_prompt">What do you need?</Label>
                <Textarea
                  id="pq_prompt"
                  rows={4}
                  maxLength={MAX_PROMPT}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g. An easy string question: check whether a PAN number is valid, for a bank's account-opening form. Use loops, no regex."
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" size="sm" disabled={generating || running || prompt.trim().length < MIN_PROMPT} onClick={() => void generateDraft()}>
                  <SparklesIcon />
                  {generate.isPending ? "Generating…" : checkingDraft ? "Checking with Python…" : filled ? "Generate again" : "Generate"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {filled
                    ? "Generating again replaces everything below."
                    : "Fills every card below with a draft and a Python solution, and sets each expected value by running that solution here. Nothing is saved until you save."}
                </span>
              </div>
            </Section>
          )}

          <Section n={1} title="Basics">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="pq_title">Title</Label>
                <Input
                  id="pq_title"
                  placeholder="e.g. Leap Year"
                  maxLength={80}
                  value={q.title}
                  onChange={(e) => set(slugEdited ? { title: e.target.value } : { title: e.target.value, slug: slugify(e.target.value) })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pq_slug">Slug</Label>
                <Input
                  id="pq_slug"
                  placeholder="e.g. leap-year"
                  maxLength={64}
                  value={q.slug}
                  disabled={published}
                  onChange={(e) => {
                    set({ slug: e.target.value });
                    setSlugEdited(true);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {published ? "Can't be changed: students' answers are saved under it." : "Fixed once published. Students' answers are saved as practice/<slug>."}
                </p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label>Difficulty</Label>
                <Toggle value={q.difficulty} items={DIFFICULTIES} onChange={(difficulty) => set({ difficulty })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pq_topic">Topic</Label>
                <Input id="pq_topic" placeholder="e.g. Loops, Strings, Arrays" maxLength={40} value={q.topic} onChange={(e) => set({ topic: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>Access</Label>
                <Toggle
                  value={q.access}
                  items={[
                    { value: "public", label: "Public" },
                    { value: "private", label: "Private" },
                  ]}
                  onChange={(access) => set({ access })}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {q.access === "public" ? "Public: every PrepCode student, guests included." : "Private: only students of colleges that subscribe to this category."}
            </p>
          </Section>

          <Section
            n={2}
            title="Case study"
            aside={
              <Ok ok={words >= MIN_WORDS}>
                {words} words{words >= MIN_WORDS ? " ✓" : `, at least ${MIN_WORDS}`}
              </Ok>
            }
          >
            <MarkdownField
              id="pq_description"
              label="Description"
              rows={10}
              value={q.description}
              onChange={(description) => set({ description })}
              placeholder="A real situation: a named company or app with a problem the student's method fixes. End with what to return. Don't include the examples or constraints."
            />
            <div className="grid gap-1.5">
              <Label htmlFor="pq_constraints">Constraints</Label>
              <Input id="pq_constraints" placeholder="e.g. `1 ≤ year ≤ 9999`" value={q.constraints} onChange={(e) => set({ constraints: e.target.value })} />
            </div>
            <MarkdownField
              id="pq_explanation"
              label="Explanation (optional)"
              rows={4}
              value={q.explanation}
              onChange={(explanation) => set({ explanation })}
              placeholder="How to solve it. Stored now; students will see it later."
            />
          </Section>

          <Section n={3} title="Method">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="pq_method">Method name</Label>
                <Input id="pq_method" placeholder="e.g. isLeapYear" maxLength={40} value={q.method} onChange={(e) => set({ method: e.target.value.trim() })} />
                {q.method && nameProblem(q.method) && <p className="text-xs text-destructive">{nameProblem(q.method)}</p>}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pq_returns">Returns</Label>
                <TypeSelect id="pq_returns" value={q.returns} onChange={(returns) => set({ returns })} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Parameters</Label>
              {q.params.length === 0 && <p className="text-xs text-muted-foreground">No parameters. That's allowed.</p>}
              {q.params.map((p, i) => {
                const problem = p.name ? (nameProblem(p.name) ?? (/^_?pc/.test(p.name) ? "Names starting with pc are reserved" : null)) : null;
                const duplicate = p.name && q.params.findIndex((x) => x.name === p.name) !== i;
                return (
                  <div key={p.id} className="grid gap-1">
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label={`Parameter ${i + 1} name`}
                        placeholder="e.g. year"
                        maxLength={40}
                        value={p.name}
                        onChange={(e) => setParam(p.id, { name: e.target.value.trim() })}
                        className="w-48"
                      />
                      <TypeSelect id={`pq_param_${p.id}`} value={p.type} onChange={(type) => setParam(p.id, { type })} />
                      <Button type="button" variant="ghost" size="icon-sm" title="Remove" aria-label={`Remove parameter ${p.name}`} onClick={() => removeParam(p.id)}>
                        <XIcon />
                      </Button>
                    </div>
                    {(problem || duplicate) && <p className="text-xs text-destructive">{duplicate ? "Another parameter has this name" : problem}</p>}
                  </div>
                );
              })}
              <div>
                <Button type="button" variant="outline" size="sm" onClick={addParam}>
                  <PlusIcon />
                  Parameter
                </Button>
              </div>
            </div>
          </Section>

          <Section
            n={4}
            title="Solution"
            aside={
              <Ok ok={written.length > 0 && written.every(passesAllIn)}>
                {written.length === 0
                  ? "No solution yet"
                  : `${written.map((l) => `${languageLabel(l)} ${passesAllIn(l) ? "✓" : "not passing"}`).join(" · ")}`}
              </Ok>
            }
          >
            <div className="grid gap-1.5">
              <Label>Language</Label>
              <div className="flex flex-wrap gap-1">
                {LANGUAGES.map((l) => {
                  const r = runtimes.data?.find((x) => x.id === l.id);
                  const has = written.includes(l.id);
                  const ok = has && passesAllIn(l.id);
                  return (
                    <Button
                      key={l.id}
                      type="button"
                      size="sm"
                      variant={language === l.id ? "secondary" : "ghost"}
                      aria-pressed={language === l.id}
                      title={[has ? (ok ? "Solution passes every case" : "Solution written") : "No solution yet", r && !r.installed ? "runtime not installed" : ""]
                        .filter(Boolean)
                        .join(", ")}
                      onClick={() => set({ solution_language: l.id })}
                      className={cn(r && !r.installed && "text-muted-foreground")}
                    >
                      {l.label}
                      {ok ? (
                        <CheckIcon className="text-emerald-600" />
                      ) : has ? (
                        <span className="size-1.5 rounded-full bg-amber-500" aria-hidden />
                      ) : null}
                    </Button>
                  );
                })}
              </div>
              <RuntimeLine
                language={language}
                runtime={runtime}
                checking={runtimes.isFetching}
                inApp={runtimes.data !== null}
                onRecheck={() => void runtimes.refetch()}
              />
            </div>
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label>{languageLabel(language)} solution</Label>
                {code !== starterCode(q, language) && (
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      const { [language]: _removed, ...rest } = q.solutions;
                      set({ solutions: rest });
                    }}
                  >
                    Reset to starter code
                  </Button>
                )}
              </div>
              <LazyCodeEditor
                key={language}
                value={code}
                onChange={(text) => set({ solutions: { ...q.solutions, [language]: text } })}
                language={language}
                minLines={15}
                ariaLabel={`${languageLabel(language)} solution`}
              />
              <p className="text-xs text-muted-foreground">
                Each language has its own solution; write one or more. Students never see them. A test case is accepted only when every
                written solution passes it, which catches a wrong expected value before students do.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" size="sm" disabled={running || !runtime?.installed} onClick={() => void runSolution()}>
                <PlayIcon />
                {running ? (language === "csharp" ? "Running… (C# can take a while the first time)" : "Running…") : `Run ${languageLabel(language)} against test cases`}
              </Button>
              {written.includes(language) && q.test_cases.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {languageLabel(language)} passes {passed} of {q.test_cases.length} test cases
                </span>
              )}
            </div>
            {compileErrors[language] && compileErrors[language].code === (q.solutions[language] ?? "") && (
              <div className="grid gap-1 border border-destructive/40 bg-destructive/5 p-3">
                <p className="text-xs font-medium text-destructive">Didn't compile</p>
                <pre className="max-h-64 overflow-auto font-mono text-xs whitespace-pre-wrap">{compileErrors[language].text}</pre>
              </div>
            )}
          </Section>

          <Section
            n={5}
            title="Test cases"
            aside={
              <Ok ok={examples >= MIN_EXAMPLES}>
                {examples} examples{examples >= MIN_EXAMPLES ? " ✓" : `, at least ${MIN_EXAMPLES}`} · {hidden} hidden
              </Ok>
            }
          >
            <TestCasesTable q={q} resultOf={(t) => resultIn(language, t)} onChange={setCase} onMove={moveCase} onRemove={(id) => set({ test_cases: q.test_cases.filter((t) => t.id !== id) })} />
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => set({ test_cases: [...q.test_cases, emptyTestCase(q.params, "example")] })}>
                <PlusIcon />
                Example
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => set({ test_cases: [...q.test_cases, emptyTestCase(q.params, "hidden")] })}>
                <PlusIcon />
                Hidden case
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Examples are shown to students and checked by Run and Submit. Hidden cases are checked only at Submit. Strings are typed without quotes;
              lists as [1, 2, 3] or ["a", "b"].
            </p>
          </Section>
        </div>

        <div className="min-w-0">
          <div className="grid gap-2 xl:sticky xl:top-4">
            <p className="text-sm font-medium">Student preview</p>
            <StudentPreview q={q} />
          </div>
        </div>
      </div>

      <CategoryDialog
        open={moving}
        title="Move question"
        description="Choose the category this question belongs to."
        action="Move here"
        domains={domains}
        categories={categories}
        initialDomainId={category?.domain_id}
        initialSlug={q.category_slug}
        onClose={() => setMoving(false)}
        onPick={(slug) => {
          setMoving(false);
          set({ category_slug: slug });
        }}
      />
    </form>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Choosing a domain, then a category
// ---------------------------------------------------------------------------------------------------------------

function CategoryDialog({
  open,
  title,
  description,
  action,
  domains,
  categories,
  initialDomainId,
  initialSlug,
  onClose,
  onPick,
}: {
  open: boolean;
  title: string;
  description: string;
  action: string;
  domains: PcDomain[];
  categories: PcCategory[];
  initialDomainId?: string;
  initialSlug: string;
  onClose: () => void;
  onPick: (slug: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {open && (
          <CategoryPicker
            title={title}
            description={description}
            action={action}
            domains={domains}
            categories={categories}
            initialDomainId={initialDomainId ?? domains.find((d) => !d.archived_at)?.id ?? ""}
            initialSlug={initialSlug}
            onPick={onPick}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CategoryPicker({
  title,
  description,
  action,
  domains,
  categories,
  initialDomainId,
  initialSlug,
  onPick,
}: {
  title: string;
  description: string;
  action: string;
  domains: PcDomain[];
  categories: PcCategory[];
  initialDomainId: string;
  initialSlug: string;
  onPick: (slug: string) => void;
}) {
  const [domainId, setDomainId] = useState(initialDomainId);
  const [slug, setSlug] = useState(initialSlug);
  // Only active domains and categories take questions.
  const domainItems: Item[] = domains.filter((d) => !d.archived_at).map((d) => ({ value: d.id, label: d.title }));
  const categoryItems: Item[] = categories.filter((c) => c.domain_id === domainId && !c.archived_at).map((c) => ({ value: c.slug, label: c.title }));
  const valid = categoryItems.some((c) => c.value === slug);

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onPick(slug);
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="pq_pick_domain">Domain</Label>
        <FilterSelect
          id="pq_pick_domain"
          value={domainId}
          items={domainItems}
          placeholder="Choose a domain"
          className="w-full"
          onChange={(v) => {
            if (v === domainId) return;
            setDomainId(v);
            setSlug("");
          }}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="pq_pick_category">Category</Label>
        <FilterSelect
          id="pq_pick_category"
          value={valid ? slug : ""}
          items={categoryItems}
          placeholder={!domainId ? "Choose a domain first" : categoryItems.length ? "Choose a category" : "No categories in this domain"}
          className="w-full"
          onChange={setSlug}
        />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={!valid}>
          {action}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Whether the solution's language can run on this computer. */
function RuntimeLine({
  language,
  runtime,
  checking,
  inApp,
  onRecheck,
}: {
  language: Language;
  runtime: RuntimeStatus | undefined;
  checking: boolean;
  inApp: boolean;
  onRecheck: () => void;
}) {
  const recheck = (
    <Button type="button" variant="link" size="xs" className="h-auto px-0" disabled={checking} onClick={onRecheck}>
      {checking ? "Checking…" : "Check again"}
    </Button>
  );
  if (!inApp) return <p className="text-xs text-muted-foreground">Solutions can only be run in the prepwisely desktop app.</p>;
  if (!runtime) return <p className="text-xs text-muted-foreground">Checking which languages this computer has…</p>;
  if (runtime.installed) {
    return (
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <CheckIcon className="size-3.5 text-emerald-600" />
        {runtime.version ?? `${languageLabel(language)} is installed`} {recheck}
      </p>
    );
  }
  return (
    <div className="flex items-start gap-2 border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
      <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
      <div className="grid gap-0.5">
        <p className="font-medium text-destructive">{languageLabel(language)} runtime not installed</p>
        <p className="text-muted-foreground">
          {INSTALL_HINT[language]} Then restart prepwisely or {recheck}
        </p>
      </div>
    </div>
  );
}

function Toggle<T extends string>({ value, items, onChange }: { value: T; items: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((i) => (
        <Button key={i.value} type="button" size="sm" variant={value === i.value ? "secondary" : "ghost"} aria-pressed={value === i.value} onClick={() => onChange(i.value)}>
          {i.label}
        </Button>
      ))}
    </div>
  );
}

const TYPE_ITEMS: Item[] = VALUE_TYPES.map((t) => ({ value: t, label: t }));

function TypeSelect({ id, value, onChange }: { id: string; value: ValueType; onChange: (t: ValueType) => void }) {
  return <FilterSelect id={id} value={value} items={TYPE_ITEMS} onChange={(v) => onChange(v as ValueType)} className="w-32" />;
}

function ChecksPanel({ checks }: { checks: { label: string; ok: boolean }[] }) {
  return (
    <div className="grid gap-1 border border-destructive/40 bg-destructive/5 p-3">
      <p className="text-sm font-medium">Can't publish yet:</p>
      {checks.map((c) => (
        <p key={c.label} className={cn("flex items-center gap-1.5 text-xs", c.ok ? "text-muted-foreground" : "text-destructive")}>
          {c.ok ? <CheckIcon className="size-3.5" /> : <XIcon className="size-3.5" />}
          {c.label}
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------------------------------------------

const VISIBILITY_ITEMS: Item[] = [
  { value: "example", label: "Example" },
  { value: "hidden", label: "Hidden" },
];
const BOOL_ITEMS: Item[] = [
  { value: "true", label: "true" },
  { value: "false", label: "false" },
];

function ValueInput({ id, type, value, onChange, label }: { id: string; type: ValueType; value: string; onChange: (v: string) => void; label: string }) {
  const c = checkValue(type, value);
  // Don't flag a box nobody has typed in yet.
  const invalid = value !== "" && !c.ok;
  if (type === "bool") {
    return (
      <Select value={value || null} onValueChange={(v) => v && onChange(v)} items={BOOL_ITEMS}>
        <SelectTrigger id={id} className="w-24" aria-label={label}>
          <SelectValue placeholder="choose" />
        </SelectTrigger>
        <SelectContent>
          {BOOL_ITEMS.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return (
    <Input
      id={id}
      aria-label={label}
      aria-invalid={invalid || undefined}
      title={invalid && !c.ok ? c.error : undefined}
      placeholder={VALUE_PLACEHOLDER[type]}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-w-28 font-mono"
    />
  );
}

function ResultCell({ result }: { result: CaseResult | undefined }) {
  if (!result) return <span className="text-xs text-muted-foreground">Not run</span>;
  if (result.status === "passed")
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-600">
        <CheckIcon className="size-3.5" />
        Passed
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-xs text-destructive" title={result.status === "error" ? result.message : undefined}>
      <XIcon className="size-3.5 shrink-0" />
      {result.status === "failed" ? `Got ${result.got}` : "Error"}
    </span>
  );
}

function TestCasesTable({
  q,
  resultOf,
  onChange,
  onMove,
  onRemove,
}: {
  q: PracticeQuestion;
  resultOf: (t: TestCase) => CaseResult | undefined;
  onChange: (id: string, patch: Partial<TestCase>) => void;
  onMove: (index: number, by: -1 | 1) => void;
  onRemove: (id: string) => void;
}) {
  if (q.test_cases.length === 0) {
    return <p className="border p-4 text-center text-xs text-muted-foreground">No test cases yet. Add at least {MIN_EXAMPLES} examples.</p>;
  }
  const columns = 5 + q.params.length + 1;
  return (
    <div className="overflow-x-auto border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16" />
            <TableHead className="w-28">Shown as</TableHead>
            {q.params.map((p) => (
              <TableHead key={p.id}>
                {p.name || "?"} <span className="font-normal text-muted-foreground">({p.type})</span>
              </TableHead>
            ))}
            <TableHead>
              Expected <span className="font-normal text-muted-foreground">({q.returns})</span>
            </TableHead>
            <TableHead>Note</TableHead>
            <TableHead className="w-24">{languageLabel(q.solution_language)}</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {q.test_cases.map((t, i) => {
            const valueErrors = testCaseErrors(q, t).filter((e) => !e.endsWith("Required") && !e.endsWith("Choose true or false"));
            const result = resultOf(t);
            const errors = valueErrors.length
              ? valueErrors
              : result?.status === "error"
                ? [result.message]
                : result?.status === "failed"
                  ? [`The solution returned ${result.got}, expected ${shownValue(q.returns, t.expected)}`]
                  : [];
            return [
              <TableRow key={t.id} className={cn(errors.length > 0 && "border-b-0")}>
                <TableCell>
                  <div className="flex">
                    <Button type="button" variant="ghost" size="icon-xs" aria-label="Move up" disabled={i === 0} onClick={() => onMove(i, -1)}>
                      <ArrowUpIcon />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-xs" aria-label="Move down" disabled={i === q.test_cases.length - 1} onClick={() => onMove(i, 1)}>
                      <ArrowDownIcon />
                    </Button>
                  </div>
                </TableCell>
                <TableCell>
                  <FilterSelect
                    id={`pq_vis_${t.id}`}
                    value={t.visibility}
                    items={VISIBILITY_ITEMS}
                    onChange={(v) => onChange(t.id, { visibility: v as Visibility })}
                    className="w-26"
                  />
                </TableCell>
                {q.params.map((p) => (
                  <TableCell key={p.id}>
                    <ValueInput
                      id={`pq_in_${t.id}_${p.id}`}
                      label={`${p.name} for test case ${i + 1}`}
                      type={p.type}
                      value={t.inputs[p.id] ?? ""}
                      onChange={(v) => onChange(t.id, { inputs: { ...t.inputs, [p.id]: v } })}
                    />
                  </TableCell>
                ))}
                <TableCell>
                  <ValueInput
                    id={`pq_exp_${t.id}`}
                    label={`Expected for test case ${i + 1}`}
                    type={q.returns}
                    value={t.expected}
                    onChange={(expected) => onChange(t.id, { expected })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    aria-label={`Note for test case ${i + 1}`}
                    placeholder={t.visibility === "example" ? "optional, shown under it" : "optional"}
                    value={t.note}
                    onChange={(e) => onChange(t.id, { note: e.target.value })}
                    className="min-w-40"
                  />
                </TableCell>
                <TableCell>
                  <ResultCell result={resultOf(t)} />
                </TableCell>
                <TableCell>
                  <Button type="button" variant="ghost" size="icon-sm" title="Remove" aria-label={`Remove test case ${i + 1}`} onClick={() => onRemove(t.id)}>
                    <XIcon />
                  </Button>
                </TableCell>
              </TableRow>,
              errors.length > 0 && (
                <TableRow key={`${t.id}-errors`} className="hover:bg-transparent">
                  <TableCell />
                  <TableCell colSpan={columns} className="pt-0 font-mono text-xs whitespace-pre-wrap text-destructive">
                    {errors.join(" · ")}
                  </TableCell>
                </TableRow>
              ),
            ];
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// What the student sees
// ---------------------------------------------------------------------------------------------------------------

function StudentPreview({ q }: { q: PracticeQuestion }) {
  const [language, setLanguage] = useState<Language>("java");
  const examples = q.test_cases.filter((t) => t.visibility === "example");
  return (
    <div className="grid gap-4 border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-lg font-semibold">{q.title.trim() || "Title"}</p>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant="outline">{difficultyLabel(q.difficulty)}</Badge>
          {q.access === "private" && <LockIcon className="size-3.5 text-muted-foreground" aria-label="Private" />}
        </div>
      </div>

      {q.description.trim() ? <Markdown>{q.description}</Markdown> : <p className="text-sm text-muted-foreground">The case study appears here.</p>}

      {examples.map((t, i) => (
        <div key={t.id} className="grid gap-1">
          <p className="text-sm font-semibold">Example {i + 1}</p>
          <pre className="overflow-x-auto bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap">
            {`Input:  ${q.params.map((p) => `${p.name || "?"} = ${shownValue(p.type, t.inputs[p.id] ?? "")}`).join(", ")}\nOutput: ${shownValue(q.returns, t.expected)}`}
          </pre>
          {t.note.trim() && <Markdown className="text-xs text-muted-foreground">{t.note}</Markdown>}
        </div>
      ))}

      {q.constraints.trim() && (
        <div className="grid gap-1">
          <p className="text-sm font-semibold">Constraints</p>
          <Markdown>{`- ${q.constraints}`}</Markdown>
        </div>
      )}

      <div className="grid gap-1">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Starter code</p>
          <Toggle value={language} items={LANGUAGES.map((l) => ({ value: l.id, label: l.label }))} onChange={setLanguage} />
        </div>
        <pre className="overflow-x-auto bg-muted px-3 py-2 font-mono text-xs">{starterCode(q, language)}</pre>
      </div>
    </div>
  );
}
