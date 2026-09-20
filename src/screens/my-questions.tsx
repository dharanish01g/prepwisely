import { useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";
import { ImportQuestionsDialog } from "@/components/import-questions-dialog";
import { RefreshButton } from "@/components/refresh-button";
import { QuestionStatusBadge } from "@/components/question-status-badge";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isLocked, type QuestionStatus, STATUS_META, useMyQuestions, useRefreshQuestions } from "@/lib/questions";

const ALL = "all";
const FEEDBACK_STATUSES: QuestionStatus[] = ["changes_requested", "rejected"];

const STATUS_ITEMS = [
  { value: ALL, label: "All statuses" },
  ...(Object.keys(STATUS_META) as QuestionStatus[]).map((s) => ({ value: s, label: STATUS_META[s].label })),
];

interface MyQuestionsScreenProps {
  /** "all" lists every question; "feedback" lists only those the reviewer sent back. */
  mode: "all" | "feedback";
  onEdit: (questionId: string) => void;
}

export function MyQuestionsScreen({ mode, onEdit }: MyQuestionsScreenProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(ALL);
  const { data: questions = [], isPending, isFetching, error } = useMyQuestions();
  const refresh = useRefreshQuestions();
  const feedbackMode = mode === "feedback";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return questions.filter((item) => {
      if (feedbackMode && !FEEDBACK_STATUSES.includes(item.status)) return false;
      if (!feedbackMode && status !== ALL && item.status !== status) return false;
      if (!q) return true;
      return [item.title, item.category_name ?? "", item.latest_review?.comment ?? ""].some((v) => v.toLowerCase().includes(q));
    });
  }, [questions, query, status, feedbackMode]);

  const columns = feedbackMode ? 5 : 6;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{feedbackMode ? "Reviewer feedback" : "My questions"}</h1>
          <p className="text-sm text-muted-foreground">
            {feedbackMode
              ? "Questions the reviewer sent back. Fix them and submit again."
              : "Everything you've written, and where each question is in review."}
          </p>
        </div>
        <div className="flex gap-2">
          <RefreshButton onRefresh={() => void refresh()} refreshing={isFetching} />
          {!feedbackMode && <ImportQuestionsDialog />}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative w-full max-w-sm">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={feedbackMode ? "Search by title, category or feedback" : "Search by title or category"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        {!feedbackMode && (
          <Select value={status} onValueChange={(v) => setStatus(v ?? ALL)} items={STATUS_ITEMS}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_ITEMS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Category</TableHead>
              {!feedbackMode && <TableHead>Difficulty</TableHead>}
              <TableHead>Status</TableHead>
              {feedbackMode ? <TableHead>Feedback</TableHead> : <TableHead>Updated</TableHead>}
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableSkeletonRows columns={["w-48", "w-28", ...(feedbackMode ? [] : ["w-16"]), "w-20", "w-28", "w-14 ml-auto"]} />
            ) : error || filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns} className={`h-24 text-center ${error ? "text-destructive" : "text-muted-foreground"}`}>
                  {error
                    ? `Could not load questions: ${error.message}`
                    : questions.length === 0 && !feedbackMode
                      ? "You haven't written any questions yet."
                      : feedbackMode && questions.length > 0 && !query
                        ? "Nothing to fix. No questions have been sent back."
                        : "No questions found."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((item) => {
                const locked = isLocked(item.status, item.archived);
                return (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-64 truncate font-medium">{item.title}</TableCell>
                    <TableCell className="text-muted-foreground">{item.category_name ?? "—"}</TableCell>
                    {!feedbackMode && <TableCell className="capitalize">{item.difficulty ?? "—"}</TableCell>}
                    <TableCell>
                      <QuestionStatusBadge status={item.status} archived={item.archived} />
                    </TableCell>
                    {feedbackMode ? (
                      <TableCell className="max-w-72 truncate text-muted-foreground">{item.latest_review?.comment ?? "—"}</TableCell>
                    ) : (
                      <TableCell className="text-muted-foreground">{new Date(item.updated_at).toLocaleDateString()}</TableCell>
                    )}
                    <TableCell>
                      <div className="flex justify-end">
                        <Button variant="outline" size="xs" onClick={() => onEdit(item.id)}>
                          {locked ? "View" : feedbackMode ? "Fix & resubmit" : "Edit"}
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
    </div>
  );
}
