import type { ReactNode } from "react";
import { ArrowLeftIcon, Loader2Icon } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { QuestionStatusBadge } from "@/components/question-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCategoryPaths } from "@/lib/categories";
import type { ReviewDecision } from "@/lib/question-schema";
import { type ReviewDetail, useReviewDetail } from "@/lib/review";

export const DECISION_LABEL: Record<ReviewDecision, string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  rejected: "Rejected",
};

/** A question as a reader sees it: text, every option with its explanation, the correct answer, earlier review rounds. */
export function QuestionDetail({ question, showStatus = false }: { question: ReviewDetail; showStatus?: boolean }) {
  const categoryPath = useCategoryPaths();

  return (
    <>
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold">{question.title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {showStatus && <QuestionStatusBadge status={question.status} archived={question.archived} />}
          {question.difficulty && (
            <Badge variant="secondary" className="capitalize">
              {question.difficulty}
            </Badge>
          )}
          <span>{categoryPath.get(question.category_id ?? "") ?? "No category"}</span>
        </div>
      </div>

      {question.reviews.length > 0 && (
        <div className="grid gap-2 border p-3">
          <p className="text-xs font-medium">Review history</p>
          {question.reviews.map((r) => (
            <div key={r.id} className="grid gap-1 border-t pt-2 first:border-t-0 first:pt-0">
              <p className="text-xs text-muted-foreground">
                {DECISION_LABEL[r.decision]} · {new Date(r.created_at).toLocaleDateString()}
              </p>
              {r.comment && <Markdown>{r.comment}</Markdown>}
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-1.5">
        <p className="text-xs font-medium text-muted-foreground">Description</p>
        <Markdown>{question.description}</Markdown>
      </div>

      <div className="grid gap-3">
        <h2 className="text-base font-semibold">Options</h2>
        {question.options.map((option, index) => (
          <div key={option.id} className={`grid gap-2 border p-3 ${option.is_correct ? "border-primary" : ""}`}>
            <div className="flex items-center gap-2 text-xs font-medium">
              <span>Option {String.fromCharCode(65 + index)}</span>
              {option.is_correct && <Badge>Correct answer</Badge>}
            </div>
            <Markdown>{option.body}</Markdown>
            <div className="grid gap-1 border-t pt-2">
              <p className="text-xs font-medium text-muted-foreground">{option.is_correct ? "Why it's correct" : "Why it's wrong"}</p>
              <Markdown className="text-muted-foreground">{option.explanation}</Markdown>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

interface QuestionPanelProps {
  id: string;
  onBack: () => void;
  backLabel: string;
  /** Rendered under the question once it has loaded (a decision form, archive controls, ...). */
  actions?: (question: ReviewDetail) => ReactNode;
  showStatus?: boolean;
}

/** Loads one question and shows it with a back button. */
export function QuestionPanel({ id, onBack, backLabel, actions, showStatus }: QuestionPanelProps) {
  const { data, isPending, error } = useReviewDetail(id);

  return (
    <div className="flex max-w-3xl flex-1 flex-col gap-5 p-4 pt-0">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
          <ArrowLeftIcon />
          {backLabel}
        </Button>
      </div>
      {isPending ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">Could not load this question: {error.message}</p>
      ) : (
        <>
          <QuestionDetail question={data} showStatus={showStatus} />
          {actions?.(data)}
        </>
      )}
    </div>
  );
}
