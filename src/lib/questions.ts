import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import type { ImportQuestion } from "@/lib/question-import";

export type QuestionStatus = "draft" | "submitted" | "approved" | "changes_requested" | "rejected" | "unverified";
export type Difficulty = "easy" | "medium" | "hard";

export const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

export const STATUS_META: Record<
  QuestionStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  draft: { label: "Draft", variant: "secondary" },
  submitted: { label: "In review", variant: "outline" },
  approved: { label: "Approved", variant: "default" },
  changes_requested: { label: "Changes requested", variant: "destructive" },
  rejected: { label: "Rejected", variant: "destructive" },
  unverified: { label: "Unverified", variant: "outline" },
};

/** The creator can't touch a question while it is in review or archived; the database enforces the same. */
export const isLocked = (status: QuestionStatus, archived: boolean) => archived || status === "submitted";

export interface ReviewFeedback {
  decision: "approved" | "changes_requested" | "rejected";
  comment: string | null;
  created_at: string;
}

export interface QuestionListItem {
  id: string;
  title: string;
  status: QuestionStatus;
  difficulty: Difficulty | null;
  updated_at: string;
  archived: boolean;
  category_name: string | null;
  latest_review: ReviewFeedback | null;
}

export interface OptionInput {
  /** Generated on the client for new options so a save is a single upsert. */
  id: string;
  body: string;
  explanation: string;
  is_correct: boolean;
}

export interface QuestionInput {
  title: string;
  description: string;
  category_id: string | null;
  difficulty: Difficulty | null;
  options: OptionInput[];
}

export interface QuestionDetail extends QuestionInput {
  id: string;
  status: QuestionStatus;
  archived: boolean;
  latest_review: ReviewFeedback | null;
}

export const newOption = (): OptionInput => ({ id: crypto.randomUUID(), body: "", explanation: "", is_correct: false });

// PostgREST errors aren't `Error` instances; normalise so callers can show `.message`.
const toError = (error: { message: string }) => new Error(error.message);

const QUESTIONS_KEY = ["questions"] as const;

export { validateDraft, validateForSubmit } from "@/lib/question-schema";


/** Re-fetches every questions query (lists and open editors) so changes made elsewhere show up. */
export function useRefreshQuestions() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: QUESTIONS_KEY });
}

/** The signed-in creator's own questions, newest activity first. */
export function useMyQuestions() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...QUESTIONS_KEY, "mine", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<QuestionListItem[]> => {
      const { data, error } = await supabase
        .from("questions")
        .select(
          "id, title, status, difficulty, updated_at, archived_at, category:categories(name), reviews:question_reviews(decision, comment, created_at)",
        )
        .eq("created_by", user!.id)
        .order("updated_at", { ascending: false })
        .order("created_at", { referencedTable: "question_reviews", ascending: false })
        .limit(1, { referencedTable: "question_reviews" });
      if (error) throw toError(error);
      return data.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        difficulty: row.difficulty,
        updated_at: row.updated_at,
        archived: row.archived_at !== null,
        // Untyped client: the select string infers an array, but a many-to-one embed comes back as an object.
        category_name: (row.category as unknown as { name: string } | null)?.name ?? null,
        latest_review: (row.reviews as ReviewFeedback[])[0] ?? null,
      }));
    },
  });
}

export function useQuestion(id: string | null) {
  return useQuery({
    queryKey: [...QUESTIONS_KEY, "detail", id],
    enabled: !!id,
    queryFn: async (): Promise<QuestionDetail> => {
      const { data, error } = await supabase
        .from("questions")
        .select(
          "id, title, description, category_id, difficulty, status, archived_at, options:question_options(id, position, body, explanation, is_correct), reviews:question_reviews(decision, comment, created_at)",
        )
        .eq("id", id!)
        .order("position", { referencedTable: "question_options" })
        .order("created_at", { referencedTable: "question_reviews", ascending: false })
        .limit(1, { referencedTable: "question_reviews" })
        .single();
      if (error) throw toError(error);
      return {
        id: data.id,
        title: data.title,
        description: data.description,
        category_id: data.category_id,
        difficulty: data.difficulty,
        status: data.status,
        archived: data.archived_at !== null,
        options: (data.options as OptionInput[]).map(({ id, body, explanation, is_correct }) => ({ id, body, explanation, is_correct })),
        latest_review: (data.reviews as ReviewFeedback[])[0] ?? null,
      };
    },
  });
}

interface SaveArgs {
  /** Omit to create a new draft. */
  id?: string;
  input: QuestionInput;
  /** Option ids that exist in the database but are no longer in the form. */
  removedOptionIds: string[];
}

/**
 * Creates or updates a question and syncs its options. Not atomic (three requests), but ordered so a
 * failure part-way leaves a valid draft: question first, then removals, then one upsert of the rest.
 */
export function useSaveQuestion() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ id, input, removedOptionIds }: SaveArgs): Promise<string> => {
      const values = {
        title: input.title.trim(),
        description: input.description,
        category_id: input.category_id,
        difficulty: input.difficulty,
      };

      let questionId = id;
      if (questionId) {
        // RLS filters rows silently, so an empty result means the question is locked or not ours.
        const { data, error } = await supabase.from("questions").update(values).eq("id", questionId).select("id");
        if (error) throw toError(error);
        if (!data.length) throw new Error("This question can no longer be edited");
      } else {
        const { data, error } = await supabase
          .from("questions")
          .insert({ ...values, created_by: user!.id })
          .select("id")
          .single();
        if (error) throw toError(error);
        questionId = data.id as string;
      }

      if (removedOptionIds.length) {
        const { error } = await supabase.from("question_options").delete().in("id", removedOptionIds);
        if (error) throw toError(error);
      }

      if (input.options.length) {
        // Positions are renumbered 1..n; the position uniqueness check is deferred, so reordering is safe in one statement.
        const rows = input.options.map((o, i) => ({
          id: o.id,
          question_id: questionId,
          position: i + 1,
          body: o.body,
          explanation: o.explanation,
          is_correct: o.is_correct,
        }));
        const { error } = await supabase.from("question_options").upsert(rows, { onConflict: "id" });
        if (error) throw toError(error);
      }

      return questionId;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUESTIONS_KEY }),
  });
}

export function useSubmitQuestion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("submit_question", { p_question_id: id });
      if (error) throw toError(error);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUESTIONS_KEY }),
  });
}

/** Creates all the given questions in one database transaction; resolves to how many were created. */
export function useImportQuestions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ questions, submit }: { questions: ImportQuestion[]; submit: boolean }): Promise<number> => {
      const { data, error } = await supabase.rpc("import_questions", { p_rows: questions, p_submit: submit });
      if (error) throw toError(error);
      return data as number;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUESTIONS_KEY }),
  });
}
