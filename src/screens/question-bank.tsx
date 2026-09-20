import { useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";
import { toast } from "sonner";
import { FilterSelect } from "@/components/filter-select";
import { Pager } from "@/components/pager";
import { QuestionPanel } from "@/components/question-detail";
import { QuestionStatusBadge } from "@/components/question-status-badge";
import { RefreshButton } from "@/components/refresh-button";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDebounced } from "@/hooks/use-debounced";
import { buildCategoryRows, selfAndDescendantIds, useCategories, useCategoryPaths } from "@/lib/categories";
import { BANK_PAGE_SIZE, type BankFilters, useQuestionBank, useSetQuestionArchived } from "@/lib/question-bank";
import { DIFFICULTIES, type QuestionStatus, STATUS_META, useRefreshQuestions } from "@/lib/questions";
import { useMyRoleIds } from "@/lib/roles";
import type { ReviewDetail } from "@/lib/review";

const ALL = "all";

const STATUS_ITEMS = [
  { value: ALL, label: "All statuses" },
  ...(Object.keys(STATUS_META) as QuestionStatus[]).map((s) => ({ value: s, label: STATUS_META[s].label })),
];
const DIFFICULTY_ITEMS = [{ value: ALL, label: "All difficulties" }, ...DIFFICULTIES];
const ARCHIVED_ITEMS = [
  { value: "active", label: "Not archived" },
  { value: "archived", label: "Archived only" },
  { value: ALL, label: "Everything" },
];

/**
 * The full library of questions. Reviewers use it read-only (to spot duplicates); the content manager and
 * superadmin can also archive and restore. What each person sees is decided by the database.
 */
export function QuestionBankScreen() {
  // Kept here (not in the list) so filters and page survive opening a question and coming back.
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(ALL);
  const [difficulty, setDifficulty] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [archived, setArchived] = useState<BankFilters["archived"]>("active");
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: categories = [] } = useCategories();
  const categoryPath = useCategoryPaths();
  const { data: myRoles = [] } = useMyRoleIds();
  const canArchive = myRoles.includes("content_manager") || myRoles.includes("superadmin");
  const debouncedSearch = useDebounced(search);

  const filters = useMemo<BankFilters>(
    () => ({
      search: debouncedSearch,
      status: status as BankFilters["status"],
      difficulty: difficulty as BankFilters["difficulty"],
      categoryIds: category === ALL ? null : [...selfAndDescendantIds(categories, category)],
      archived,
      page,
    }),
    [debouncedSearch, status, difficulty, category, categories, archived, page],
  );
  const { data, isPending, isFetching, error } = useQuestionBank(filters);
  const refresh = useRefreshQuestions();

  const categoryItems = useMemo(
    () => [{ value: ALL, label: "All categories" }, ...buildCategoryRows(categories).map((r) => ({ value: r.category.id, label: r.path }))],
    [categories],
  );

  if (openId) {
    return (
      <QuestionPanel
        key={openId}
        id={openId}
        backLabel="Back to question bank"
        onBack={() => setOpenId(null)}
        showStatus
        actions={canArchive ? (question) => <ArchiveControls question={question} /> : undefined}
      />
    );
  }

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  // A change of filter always goes back to the first page.
  const filter = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setPage(0);
  };

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Question bank</h1>
          <p className="text-sm text-muted-foreground">
            {canArchive ? "Every question in the pipeline. Archive the ones that should leave tests." : "Search existing questions, for example to check for duplicates."}
          </p>
        </div>
        <RefreshButton onRefresh={() => void refresh()} refreshing={isFetching} />
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative w-full max-w-xs">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search title or description" value={search} onChange={(e) => filter(setSearch)(e.target.value)} className="pl-8" />
        </div>
        <FilterSelect aria-label="Filter by category" value={category} items={categoryItems} onChange={filter(setCategory)} className="w-52" />
        <FilterSelect aria-label="Filter by difficulty" value={difficulty} items={DIFFICULTY_ITEMS} onChange={filter(setDifficulty)} />
        <FilterSelect aria-label="Filter by status" value={status} items={STATUS_ITEMS} onChange={filter(setStatus)} />
        <FilterSelect
          aria-label="Filter by archived"
          value={archived}
          items={ARCHIVED_ITEMS}
          onChange={filter((v: string) => setArchived(v as BankFilters["archived"]))}
        />
      </div>

      <div className="border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Difficulty</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableSkeletonRows columns={["w-52", "w-28", "w-16", "w-20", "w-20", "w-12 ml-auto"]} />
            ) : error || rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className={`h-24 text-center ${error ? "text-destructive" : "text-muted-foreground"}`}>
                  {error ? `Could not load questions: ${error.message}` : "No questions match."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((q) => (
                <TableRow key={q.id}>
                  <TableCell className="max-w-72 truncate font-medium">{q.title}</TableCell>
                  <TableCell className="max-w-44 truncate text-muted-foreground">{categoryPath.get(q.category_id ?? "") ?? "—"}</TableCell>
                  <TableCell className="capitalize">{q.difficulty ?? "—"}</TableCell>
                  <TableCell>
                    <QuestionStatusBadge status={q.status} archived={q.archived} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{new Date(q.updated_at).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button variant="outline" size="xs" onClick={() => setOpenId(q.id)}>
                        View
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Pager page={page} pageSize={BANK_PAGE_SIZE} total={total} onPage={setPage} disabled={isFetching} />
    </div>
  );
}

function ArchiveControls({ question }: { question: ReviewDetail }) {
  const setArchived = useSetQuestionArchived();

  function handleClick() {
    const archive = !question.archived;
    setArchived.mutate(
      { id: question.id, archived: archive },
      { onSuccess: () => toast.success(`${archive ? "Archived" : "Restored"}: “${question.title}”.`) },
    );
  }

  return (
    <div className="grid gap-3 border-t pt-5 pb-4">
      <p className="text-xs text-muted-foreground">
        {question.archived
          ? "This question is archived: it is out of tests and can't be edited. Restoring puts it back exactly as it was."
          : "Archiving takes the question out of tests and locks it from edits. It is kept, and can be restored."}
      </p>
      {setArchived.error && <p className="text-xs text-destructive">{setArchived.error.message}</p>}
      <div>
        <Button variant={question.archived ? "default" : "outline"} onClick={handleClick} disabled={setArchived.isPending}>
          {setArchived.isPending ? "Saving…" : question.archived ? "Restore" : "Archive"}
        </Button>
      </div>
    </div>
  );
}
