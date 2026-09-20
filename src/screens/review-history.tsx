import { useState } from "react";
import { SearchIcon } from "lucide-react";
import { DECISION_LABEL, QuestionPanel } from "@/components/question-detail";
import { FilterSelect } from "@/components/filter-select";
import { Pager } from "@/components/pager";
import { QuestionStatusBadge } from "@/components/question-status-badge";
import { RefreshButton } from "@/components/refresh-button";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDebounced } from "@/hooks/use-debounced";
import { REVIEW_DECISIONS } from "@/lib/question-schema";
import { useRefreshQuestions } from "@/lib/questions";
import { HISTORY_PAGE_SIZE, type HistoryFilters, useReviewHistory } from "@/lib/review";

const DECISION_ITEMS = [
  { value: "all", label: "All decisions" },
  ...REVIEW_DECISIONS.map((d) => ({ value: d, label: DECISION_LABEL[d] })),
];

const DECISION_VARIANT = { approved: "default", changes_requested: "outline", rejected: "destructive" } as const;

export function ReviewHistoryScreen() {
  // Kept here (not in the list) so filters and page survive opening a question and coming back.
  const [search, setSearch] = useState("");
  const [decision, setDecision] = useState<HistoryFilters["decision"]>("all");
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  const debouncedSearch = useDebounced(search);
  const { data, isPending, isFetching, error } = useReviewHistory({ decision, search: debouncedSearch, page });
  const refresh = useRefreshQuestions();

  if (openId) {
    return <QuestionPanel key={openId} id={openId} backLabel="Back to history" onBack={() => setOpenId(null)} showStatus />;
  }

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Reviewed history</h1>
          <p className="text-sm text-muted-foreground">Every decision you've made, newest first.</p>
        </div>
        <RefreshButton onRefresh={() => void refresh()} refreshing={isFetching} />
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative w-full max-w-sm">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by question title"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            className="pl-8"
          />
        </div>
        <FilterSelect
          aria-label="Filter by decision"
          value={decision}
          items={DECISION_ITEMS}
          onChange={(v) => {
            setDecision(v as HistoryFilters["decision"]);
            setPage(0);
          }}
        />
      </div>

      <div className="border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Question</TableHead>
              <TableHead>Your decision</TableHead>
              <TableHead>Your comment</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Question now</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableSkeletonRows columns={["w-44", "w-24", "w-40", "w-20", "w-20", "w-12 ml-auto"]} />
            ) : error || rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className={`h-24 text-center ${error ? "text-destructive" : "text-muted-foreground"}`}>
                  {error ? `Could not load your history: ${error.message}` : total === 0 && !debouncedSearch && decision === "all" ? "You haven't reviewed any questions yet." : "No decisions match."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-64 truncate font-medium">{r.question.title}</TableCell>
                  <TableCell>
                    <Badge variant={DECISION_VARIANT[r.decision]}>{DECISION_LABEL[r.decision]}</Badge>
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-muted-foreground">{r.comment ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <QuestionStatusBadge status={r.question.status} archived={r.question.archived} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button variant="outline" size="xs" onClick={() => setOpenId(r.question.id)}>
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

      <Pager page={page} pageSize={HISTORY_PAGE_SIZE} total={total} onPage={setPage} disabled={isFetching} />
    </div>
  );
}
