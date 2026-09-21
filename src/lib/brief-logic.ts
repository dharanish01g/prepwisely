import { z } from "zod";

// Pure rules for briefs (no I/O), so they can be tested on their own.

export type BriefDifficulty = "easy" | "medium" | "hard";
export const BRIEF_DIFFICULTIES: BriefDifficulty[] = ["easy", "medium", "hard"];

const targetField = z
  .number({ error: "Targets must be whole numbers, 0 or more" })
  .int("Targets must be whole numbers, 0 or more")
  .min(0, "Targets must be whole numbers, 0 or more");

/** What the brief form submits. `deadline` is "" for none, otherwise yyyy-mm-dd. */
export const briefSchema = z
  .object({
    title: z.string().trim().min(1, "The title is required"),
    description: z.string(),
    category_id: z.string({ error: "Pick a category" }).min(1, "Pick a category"),
    target_easy: targetField,
    target_medium: targetField,
    target_hard: targetField,
    deadline: z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/, "The deadline must be a date"),
    creator_ids: z.array(z.string()),
  })
  .superRefine((brief, ctx) => {
    if (brief.target_easy + brief.target_medium + brief.target_hard === 0) {
      ctx.addIssue({ code: "custom", path: ["target_easy"], message: "Set a target for at least one difficulty" });
    }
  });

export interface Counts {
  approved: number;
  in_review: number;
}
export type ProgressByDifficulty = Record<BriefDifficulty, Counts>;

export const emptyProgress = (): ProgressByDifficulty => ({
  easy: { approved: 0, in_review: 0 },
  medium: { approved: 0, in_review: 0 },
  hard: { approved: 0, in_review: 0 },
});

export interface BriefTargets {
  target_easy: number;
  target_medium: number;
  target_hard: number;
}

export const targetsOf = (b: BriefTargets): Record<BriefDifficulty, number> => ({
  easy: b.target_easy,
  medium: b.target_medium,
  hard: b.target_hard,
});

export interface BriefTotals {
  target: number;
  /** Delivered questions, each difficulty capped at its target so a surplus can't hide a gap elsewhere. */
  delivered: number;
  percent: number;
  /** Still to deliver per difficulty (never negative). */
  remaining: Record<BriefDifficulty, number>;
  complete: boolean;
}

export function briefTotals(targets: BriefTargets, progress: ProgressByDifficulty): BriefTotals {
  const t = targetsOf(targets);
  const target = t.easy + t.medium + t.hard;
  const remaining = {} as Record<BriefDifficulty, number>;
  let delivered = 0;
  for (const d of BRIEF_DIFFICULTIES) {
    delivered += Math.min(progress[d].approved, t[d]);
    remaining[d] = Math.max(0, t[d] - progress[d].approved);
  }
  return { target, delivered, percent: target === 0 ? 0 : Math.round((delivered / target) * 100), remaining, complete: target > 0 && delivered === target };
}

/** Today as yyyy-mm-dd in the user's own time zone (deadlines are plain dates). */
export function todayISO(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Open, past its deadline, and not finished. The deadline day itself is not overdue. */
export function isOverdue(brief: { deadline: string | null; status: "open" | "closed" }, complete: boolean, today = todayISO()): boolean {
  return brief.status === "open" && !complete && brief.deadline !== null && brief.deadline < today;
}
