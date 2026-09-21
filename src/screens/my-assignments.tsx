import { useMemo } from "react";
import { PenLineIcon } from "lucide-react";
import { BriefProgress } from "@/components/brief-progress";
import { Markdown } from "@/components/markdown";
import { RefreshButton } from "@/components/refresh-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BRIEF_DIFFICULTIES, briefTotals, isOverdue } from "@/lib/brief-logic";
import { type BriefRow, useBriefs } from "@/lib/briefs";
import { useCategoryPaths } from "@/lib/categories";
import { useRefreshQuestions } from "@/lib/questions";

const LABEL = { easy: "easy", medium: "medium", hard: "hard" } as const;

/** The briefs assigned to the signed-in creator, with the team's shared progress. */
export function MyAssignmentsScreen({ onWrite }: { onWrite: (briefId: string) => void }) {
  const { data: briefs = [], isPending, isFetching, error } = useBriefs();
  const refresh = useRefreshQuestions();
  const categoryPath = useCategoryPaths();

  // Open briefs first, then closed ones.
  const sorted = useMemo(() => [...briefs].sort((a, b) => Number(b.status === "open") - Number(a.status === "open")), [briefs]);

  return (
    <div className="flex max-w-3xl flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">My assignments</h1>
          <p className="text-sm text-muted-foreground">What you've been asked to write. The target is shared with everyone else on the brief.</p>
        </div>
        <RefreshButton onRefresh={() => void refresh()} refreshing={isFetching} />
      </div>

      {isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : error ? (
        <p className="text-sm text-destructive">Could not load your assignments: {error.message}</p>
      ) : sorted.length === 0 ? (
        <p className="border p-6 text-center text-sm text-muted-foreground">
          Nothing has been assigned to you yet. You can still write questions from Write question.
        </p>
      ) : (
        sorted.map((b) => <AssignmentCard key={b.id} brief={b} topic={categoryPath.get(b.category_id) ?? "—"} onWrite={onWrite} />)
      )}
    </div>
  );
}

function AssignmentCard({ brief, topic, onWrite }: { brief: BriefRow; topic: string; onWrite: (briefId: string) => void }) {
  const totals = briefTotals(brief, brief.progress);
  const overdue = isOverdue(brief, totals.complete);
  const open = brief.status === "open";
  const needed = BRIEF_DIFFICULTIES.filter((d) => totals.remaining[d] > 0).map((d) => `${totals.remaining[d]} ${LABEL[d]}`);

  return (
    <div className={`grid gap-3 border p-4 ${open ? "" : "opacity-70"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="text-base font-semibold">{brief.title}</h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={open ? "default" : "secondary"} className="capitalize">
              {brief.status}
            </Badge>
            {totals.complete && <Badge variant="outline">Target met</Badge>}
            <span>{topic}</span>
            {brief.deadline && (
              <>
                <span>·</span>
                <span className={overdue ? "text-destructive" : undefined}>
                  Due {new Date(brief.deadline + "T00:00:00").toLocaleDateString()}
                  {overdue && " (overdue)"}
                </span>
              </>
            )}
          </div>
        </div>
        {open && (
          <Button size="sm" onClick={() => onWrite(brief.id)}>
            <PenLineIcon />
            Write a question
          </Button>
        )}
      </div>

      {brief.description.trim() && <Markdown className="text-muted-foreground">{brief.description}</Markdown>}

      <BriefProgress brief={brief} progress={brief.progress} full />
      {open && !totals.complete && needed.length > 0 && <p className="text-xs text-muted-foreground">Still needed: {needed.join(", ")}.</p>}
    </div>
  );
}
