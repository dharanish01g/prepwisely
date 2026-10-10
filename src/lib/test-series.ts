import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { parseOrThrow } from "@/lib/validation";

// Test series (TESTS.md 1.17): a named, ordered list of existing tests for long-running programmes (Day 1, Day 2, ...).
// Individual tests stay as they are; scheduling takes either a test or a series. A test can be in several series but
// only once per series, and archived tests can't be added. Superadmin and onboarding managers read and write series;
// writes go through the `test_series_*` functions. Nothing is deleted: series are archived.

export const MAX_SERIES_TESTS = 365;

export interface TestSeries {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  /** Test ids in day order (Day 1 first). */
  test_ids: string[];
}

const SERIES_KEY = ["test-series"] as const;

/** Every series, archived ones included, newest first. */
export function useTestSeries() {
  return useQuery({
    queryKey: SERIES_KEY,
    queryFn: async (): Promise<TestSeries[]> => {
      const { data, error } = await supabase
        .from("test_series")
        .select("id, title, created_at, updated_at, archived_at, items:test_series_items(test_id, position)")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data as unknown as (Omit<TestSeries, "test_ids"> & { items: { test_id: string; position: number }[] })[]).map(
        ({ items, ...series }) => ({ ...series, test_ids: [...items].sort((a, b) => a.position - b.position).map((i) => i.test_id) }),
      );
    },
  });
}

export interface SeriesInput {
  title: string;
  test_ids: string[];
}

const seriesSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(100, "Title can be at most 100 characters"),
  test_ids: z
    .array(z.string())
    .min(1, "Add at least one test")
    .max(MAX_SERIES_TESTS, `A series can have at most ${MAX_SERIES_TESTS} tests`)
    .refine((ids) => new Set(ids).size === ids.length, "A test can be in a series only once"),
});

function useInvalidateSeries() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: SERIES_KEY });
}

export function useCreateSeries() {
  const invalidate = useInvalidateSeries();
  return useMutation({
    mutationFn: async (input: SeriesInput): Promise<string> => {
      const s = parseOrThrow(seriesSchema, input);
      const { data, error } = await supabase.rpc("test_series_create", { p_title: s.title, p_test_ids: s.test_ids });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: invalidate,
  });
}

/** Replaces the title and the whole ordered test list. Archived series can't be edited. */
export function useUpdateSeries() {
  const invalidate = useInvalidateSeries();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: SeriesInput }) => {
      const s = parseOrThrow(seriesSchema, input);
      const { error } = await supabase.rpc("test_series_update", { p_series_id: id, p_title: s.title, p_test_ids: s.test_ids });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

export function useSetSeriesArchived() {
  const invalidate = useInvalidateSeries();
  return useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const { error } = await supabase.rpc("test_series_set_archived", { p_series_id: id, p_archived: archived });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}
