import { z } from "zod";
import { firstIssue } from "@/lib/validation";

const optionSchema = z.object({
  id: z.string(),
  body: z.string(),
  explanation: z.string(),
  is_correct: z.boolean(),
});

/** What a draft needs to be saved: a title. Everything else may be incomplete. */
export const draftSchema = z.object({
  title: z.string().trim().min(1, "The title is required"),
  description: z.string(),
  category_id: z.string().nullable(),
  difficulty: z.enum(["easy", "medium", "hard"]).nullable(),
  options: z.array(optionSchema),
});

/**
 * What a question needs to be submitted for review. Mirrors the checks submit_question runs in the
 * database, so the creator gets the message before a round trip. Issues come out in field order.
 */
export const submitSchema = draftSchema.extend({
  description: z.string().trim().min(1, "The description is required"),
  category_id: z.string({ error: "Pick a category" }),
  difficulty: z.enum(["easy", "medium", "hard"], { error: "Pick a difficulty" }),
  options: z
    .array(optionSchema)
    .min(2, "A question needs at least 2 options")
    .refine((options) => options.filter((o) => o.is_correct).length === 1, "Mark exactly one option as correct")
    .refine(
      (options) => options.every((o) => o.body.trim() && o.explanation.trim()),
      "Every option needs text and an explanation",
    ),
});

export const validateDraft = (q: unknown) => firstIssue(draftSchema, q);
export const validateForSubmit = (q: unknown) => firstIssue(submitSchema, q);

export const REVIEW_DECISIONS = ["approved", "changes_requested", "rejected"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/** A reviewer's decision. Anything other than approving needs a comment so the creator knows what to fix. */
export const reviewDecisionSchema = z
  .object({
    decision: z.enum(REVIEW_DECISIONS, { error: "Choose a decision" }),
    comment: z.string(),
  })
  .superRefine((value, ctx) => {
    if (value.decision !== "approved" && !value.comment.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["comment"],
        message: value.decision === "rejected" ? "Explain why this question is rejected" : "Say what needs to change",
      });
    }
  });

export const validateReviewDecision = (decision: ReviewDecision | null, comment: string) =>
  firstIssue(reviewDecisionSchema, { decision, comment });
