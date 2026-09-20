import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import type { ReviewDecision } from "@/lib/question-schema";
import { type Difficulty, type OptionInput, QUESTIONS_KEY, type QuestionStatus } from "@/lib/questions";
import { supabase } from "@/lib/supabase";

// PostgREST errors aren't `Error` instances; normalise so callers can show `.message`.
const toError = (error: { message: string }) => new Error(error.message);

export interface QueueItem {
  id: string;
  title: string;
  difficulty: Difficulty | null;
  category_id: string | null;
  submitted_at: string | null;
  /** Reviews this question already went through; more than zero means the creator fixed and resubmitted it. */
  previous_reviews: number;
}

export interface ReviewRecord {
  id: string;
  decision: ReviewDecision;
  comment: string | null;
  created_at: string;
}

export interface ReviewOption extends OptionInput {
  position: number;
}

export interface ReviewDetail {
  id: string;
  title: string;
  description: string;
  category_id: string | null;
  difficulty: Difficulty | null;
  status: QuestionStatus;
  archived: boolean;
  options: ReviewOption[];
  /** Earlier decisions on this question, newest first. */
  reviews: ReviewRecord[];
}

/**
 * Questions waiting for a decision, oldest first. The reviewer's own questions are left out (they can't
 * review them). Creators' names aren't shown: reviewers can't read other people's profiles.
 */
export function useReviewQueue() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...QUESTIONS_KEY, "review-queue", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<QueueItem[]> => {
      const { data, error } = await supabase
        .from("questions")
        .select("id, title, difficulty, category_id, submitted_at, reviews:question_reviews(id)")
        .eq("status", "submitted")
        .is("archived_at", null)
        .neq("created_by", user!.id)
        .order("submitted_at", { ascending: true });
      if (error) throw toError(error);
      return data.map((row) => ({
        id: row.id,
        title: row.title,
        difficulty: row.difficulty,
        category_id: row.category_id,
        submitted_at: row.submitted_at,
        previous_reviews: (row.reviews as unknown[]).length,
      }));
    },
  });
}

export function useReviewDetail(id: string) {
  return useQuery({
    queryKey: [...QUESTIONS_KEY, "review-detail", id],
    queryFn: async (): Promise<ReviewDetail> => {
      const { data, error } = await supabase
        .from("questions")
        .select(
          "id, title, description, category_id, difficulty, status, archived_at, options:question_options(id, position, body, explanation, is_correct), reviews:question_reviews(id, decision, comment, created_at)",
        )
        .eq("id", id)
        .order("position", { referencedTable: "question_options" })
        .order("created_at", { referencedTable: "question_reviews", ascending: false })
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
        options: data.options as ReviewOption[],
        reviews: data.reviews as ReviewRecord[],
      };
    },
  });
}

export function useReviewDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, decision, comment }: { id: string; decision: ReviewDecision; comment: string }) => {
      const { error } = await supabase.rpc("review_question", {
        p_question_id: id,
        p_decision: decision,
        p_comment: comment.trim() || null,
      });
      if (error) throw toError(error);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUESTIONS_KEY }),
  });
}

export const HISTORY_PAGE_SIZE = 25;

export interface HistoryFilters {
  decision: ReviewDecision | "all";
  search: string;
  page: number;
}

export interface HistoryItem {
  id: string;
  decision: ReviewDecision;
  comment: string | null;
  created_at: string;
  question: { id: string; title: string; status: QuestionStatus; archived: boolean };
}

/** Terms go into a PostgREST filter, so drop the characters that have a meaning there. */
export const cleanSearch = (raw: string) => raw.replace(/[,()"\\%_*]/g, " ").trim();

/** The signed-in reviewer's own past decisions, newest first, one page at a time. */
export function useReviewHistory(filters: HistoryFilters) {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...QUESTIONS_KEY, "review-history", user?.id, filters],
    enabled: !!user,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ rows: HistoryItem[]; total: number }> => {
      let query = supabase
        .from("question_reviews")
        // !inner so the title search below filters the reviews themselves, not just the embedded question.
        .select("id, decision, comment, created_at, question:questions!inner(id, title, status, archived_at)", { count: "exact" })
        .eq("reviewer_id", user!.id)
        .order("created_at", { ascending: false })
        .range(filters.page * HISTORY_PAGE_SIZE, (filters.page + 1) * HISTORY_PAGE_SIZE - 1);
      if (filters.decision !== "all") query = query.eq("decision", filters.decision);
      const term = cleanSearch(filters.search);
      if (term) query = query.ilike("question.title", `*${term}*`);

      const { data, error, count } = await query;
      if (error) throw toError(error);
      return {
        total: count ?? 0,
        rows: data.map((row) => {
          const q = row.question as unknown as { id: string; title: string; status: QuestionStatus; archived_at: string | null };
          return {
            id: row.id,
            decision: row.decision,
            comment: row.comment,
            created_at: row.created_at,
            question: { id: q.id, title: q.title, status: q.status, archived: q.archived_at !== null },
          };
        }),
      };
    },
  });
}
