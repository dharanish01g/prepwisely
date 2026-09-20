import { type FormEvent, useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";
import { toast } from "sonner";
import { MarkdownField } from "@/components/markdown";
import { DECISION_LABEL, QuestionPanel } from "@/components/question-detail";
import { RefreshButton } from "@/components/refresh-button";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCategoryPaths } from "@/lib/categories";
import { type ReviewDecision, validateReviewDecision } from "@/lib/question-schema";
import { useRefreshQuestions } from "@/lib/questions";
import { type ReviewDetail, useReviewDecision, useReviewQueue } from "@/lib/review";

const DECISIONS: { value: ReviewDecision; label: string; hint: string }[] = [
  { value: "approved", label: "Approve", hint: "The question is correct and clear. It becomes eligible for tests." },
  { value: "changes_requested", label: "Request changes", hint: "Fixable problems. The creator edits and resubmits." },
  { value: "rejected", label: "Reject", hint: "Not usable as it stands. The creator can still rework and resubmit it." },
];

export function ReviewQueueScreen() {
  const [openId, setOpenId] = useState<string | null>(null);

  if (openId) {
    return (
      <QuestionPanel
        key={openId}
        id={openId}
        backLabel="Back to queue"
        onBack={() => setOpenId(null)}
        actions={(question) => (
          <DecisionForm
            question={question}
            onDecided={(message) => {
              toast.success(message);
              setOpenId(null);
            }}
          />
        )}
      />
    );
  }
  return <QueueList onOpen={setOpenId} />;
}

function QueueList({ onOpen }: { onOpen: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const { data: queue = [], isPending, isFetching, error } = useReviewQueue();
  const refresh = useRefreshQuestions();
  const categoryPath = useCategoryPaths();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return queue;
    return queue.filter((item) => [item.title, categoryPath.get(item.category_id ?? "") ?? ""].some((v) => v.toLowerCase().includes(q)));
  }, [queue, query, categoryPath]);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Review queue</h1>
          <p className="text-sm text-muted-foreground">Submitted questions waiting for a decision, oldest first.</p>
        </div>
        <RefreshButton onRefresh={() => void refresh()} refreshing={isFetching} />
      </div>

      <div className="relative max-w-sm">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search by title or category" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
      </div>

      <div className="border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Difficulty</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableSkeletonRows columns={["w-52", "w-28", "w-16", "w-20", "w-14 ml-auto"]} />
            ) : error || filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className={`h-24 text-center ${error ? "text-destructive" : "text-muted-foreground"}`}>
                  {error
                    ? `Could not load the queue: ${error.message}`
                    : queue.length === 0
                      ? "Nothing is waiting for review."
                      : "No questions match your search."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="max-w-72 font-medium">
                    <span className="flex items-center gap-2">
                      <span className="truncate">{item.title}</span>
                      {item.previous_reviews > 0 && <Badge variant="outline">Resubmitted</Badge>}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{categoryPath.get(item.category_id ?? "") ?? "—"}</TableCell>
                  <TableCell className="capitalize">{item.difficulty ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.submitted_at ? new Date(item.submitted_at).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button variant="outline" size="xs" onClick={() => onOpen(item.id)}>
                        Review
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function DecisionForm({ question, onDecided }: { question: ReviewDetail; onDecided: (message: string) => void }) {
  const [decision, setDecision] = useState<ReviewDecision | null>(null);
  const [comment, setComment] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const review = useReviewDecision();

  const reviewable = question.status === "submitted" && !question.archived;
  const commentRequired = decision !== null && decision !== "approved";

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const issue = validateReviewDecision(decision, comment);
    setProblem(issue);
    if (issue || !decision) return;
    review.mutate(
      { id: question.id, decision, comment },
      { onSuccess: () => onDecided(`${DECISION_LABEL[decision]}: “${question.title}”.`) },
    );
  }

  if (!reviewable) {
    return (
      <p className="border p-3 text-xs text-muted-foreground">
        {question.archived
          ? "This question is archived and can't be reviewed."
          : "This question is no longer waiting for review. Someone may have already decided it."}
      </p>
    );
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="grid gap-4 border-t pt-5 pb-4">
      <h2 className="text-base font-semibold">Your decision</h2>
      <div className="grid gap-2">
        {DECISIONS.map((d) => (
          <label key={d.value} className="flex items-start gap-2 text-xs">
            <input
              type="radio"
              name="decision"
              className="mt-0.5 accent-primary"
              checked={decision === d.value}
              onChange={() => {
                setDecision(d.value);
                setProblem(null);
              }}
              disabled={review.isPending}
            />
            <span>
              <span className="font-medium">{d.label}</span>
              <span className="block text-muted-foreground">{d.hint}</span>
            </span>
          </label>
        ))}
      </div>

      <MarkdownField
        id="review_comment"
        label={commentRequired ? "Comment (required)" : "Comment (optional)"}
        rows={4}
        placeholder={commentRequired ? "What should the creator fix or reconsider?" : "Anything worth passing on"}
        value={comment}
        onChange={setComment}
        disabled={review.isPending}
      />

      {(problem || review.error) && <p className="text-xs text-destructive">{problem ?? review.error?.message}</p>}

      <div>
        <Button type="submit" disabled={review.isPending}>
          {review.isPending ? "Saving…" : "Submit decision"}
        </Button>
      </div>
    </form>
  );
}
