import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type Difficulty, QUESTIONS_KEY, type QuestionStatus } from "@/lib/questions";
import { cleanSearch } from "@/lib/review";
import { supabase } from "@/lib/supabase";

export const BANK_PAGE_SIZE = 25;

export interface BankFilters {
  search: string;
  status: QuestionStatus | "all";
  difficulty: Difficulty | "all";
  /** A category plus its subcategories; null means any category. */
  categoryIds: string[] | null;
  archived: "active" | "archived" | "all";
  page: number;
}

export interface BankItem {
  id: string;
  title: string;
  status: QuestionStatus;
  difficulty: Difficulty | null;
  category_id: string | null;
  archived: boolean;
  updated_at: string;
}

const toError = (error: { message: string }) => new Error(error.message);

/**
 * Every question the signed-in user is allowed to see (the database decides: reviewers and managers get
 * everything except other people's drafts), filtered and paged on the server.
 */
export function useQuestionBank(filters: BankFilters) {
  return useQuery({
    queryKey: [...QUESTIONS_KEY, "bank", filters],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ rows: BankItem[]; total: number }> => {
      let query = supabase
        .from("questions")
        .select("id, title, status, difficulty, category_id, archived_at, updated_at", { count: "exact" })
        .order("updated_at", { ascending: false })
        .range(filters.page * BANK_PAGE_SIZE, (filters.page + 1) * BANK_PAGE_SIZE - 1);

      if (filters.status !== "all") query = query.eq("status", filters.status);
      if (filters.difficulty !== "all") query = query.eq("difficulty", filters.difficulty);
      if (filters.categoryIds) query = query.in("category_id", filters.categoryIds);
      if (filters.archived === "active") query = query.is("archived_at", null);
      if (filters.archived === "archived") query = query.not("archived_at", "is", null);
      // Searching the text as well as the title is what lets a reviewer spot a near-duplicate.
      const term = cleanSearch(filters.search);
      if (term) query = query.or(`title.ilike.*${term}*,description.ilike.*${term}*`);

      const { data, error, count } = await query;
      if (error) throw toError(error);
      return {
        total: count ?? 0,
        rows: data.map((row) => ({
          id: row.id,
          title: row.title,
          status: row.status,
          difficulty: row.difficulty,
          category_id: row.category_id,
          archived: row.archived_at !== null,
          updated_at: row.updated_at,
        })),
      };
    },
  });
}

/** Content manager / superadmin only (the database checks). Archived questions are kept but leave tests. */
export function useSetQuestionArchived() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const { error } = await supabase.rpc("set_question_archived", { p_question_id: id, p_archived: archived });
      if (error) throw toError(error);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUESTIONS_KEY }),
  });
}
