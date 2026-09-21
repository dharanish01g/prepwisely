import { BRIEF_DIFFICULTIES, briefTotals, type ProgressByDifficulty, targetsOf } from "@/lib/brief-logic";
import type { Brief } from "@/lib/briefs";

const LABEL = { easy: "Easy", medium: "Medium", hard: "Hard" } as const;

function Bar({ percent }: { percent: number }) {
  return (
    <div className="h-1.5 w-full bg-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full bg-primary" style={{ width: `${Math.min(100, percent)}%` }} />
    </div>
  );
}

/** Delivered against target. Compact: one overall bar and a line of numbers; full: a bar per difficulty. */
export function BriefProgress({ brief, progress, full = false }: { brief: Brief; progress: ProgressByDifficulty; full?: boolean }) {
  const totals = briefTotals(brief, progress);
  const targets = targetsOf(brief);

  if (!full) {
    return (
      <div className="grid min-w-40 gap-1">
        <Bar percent={totals.percent} />
        <p className="text-xs text-muted-foreground">
          {totals.delivered}/{totals.target} · {BRIEF_DIFFICULTIES.filter((d) => targets[d] > 0)
            .map((d) => `${LABEL[d][0]} ${Math.min(progress[d].approved, targets[d])}/${targets[d]}`)
            .join(" · ")}
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <div className="flex justify-between text-xs">
          <span className="font-medium">Overall</span>
          <span className="text-muted-foreground">
            {totals.delivered} of {totals.target} delivered ({totals.percent}%)
          </span>
        </div>
        <Bar percent={totals.percent} />
      </div>
      {BRIEF_DIFFICULTIES.filter((d) => targets[d] > 0).map((d) => {
        const p = progress[d];
        return (
          <div key={d} className="grid gap-1">
            <div className="flex justify-between text-xs">
              <span>{LABEL[d]}</span>
              <span className="text-muted-foreground">
                {p.approved} approved of {targets[d]}
                {p.in_review > 0 && ` · ${p.in_review} in review`}
                {p.approved > targets[d] && ` · ${p.approved - targets[d]} extra`}
              </span>
            </div>
            <Bar percent={targets[d] === 0 ? 0 : Math.round((Math.min(p.approved, targets[d]) / targets[d]) * 100)} />
          </div>
        );
      })}
    </div>
  );
}
