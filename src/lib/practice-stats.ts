import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Practice statistics for the superadmin's Overview, from `superadmin_practice_stats`: coding Submits (recorded by
// PrepCode in pc_code_events) and MCQ answers (pc_mcq_events). Solved = a Submit that passed every example, or an
// MCQ answered right, counted once per person and question. Solves from before PrepCode recorded Submits count as
// solves but not as Submits.

export interface TopQuestion {
  title: string;
  slug: string;
  solvers: number;
  submits: number;
  first_try_passed: number;
  first_tries: number;
}

export interface PracticeStats {
  coding: {
    solved: number;
    solvers: number;
    submits: number;
    submitters: number;
    first_try_passed: number;
    first_tries: number;
    /** Solves on each of the last 30 India days, oldest first. */
    daily: { day: string; users: number }[];
    /** The 10 questions solved by the most people. */
    top: TopQuestion[];
  };
  mcq: {
    solved: number;
    solvers: number;
    answers: number;
    first_try_correct: number;
    first_tries: number;
  };
}

export function usePracticeStats() {
  return useQuery({
    queryKey: ["practice-stats"],
    queryFn: async (): Promise<PracticeStats> => {
      const { data, error } = await supabase.rpc("superadmin_practice_stats");
      if (error) throw new Error(error.message);
      return data as PracticeStats;
    },
  });
}
