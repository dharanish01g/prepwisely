import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { parseOrThrow } from "@/lib/validation";

// Tests (TESTS.md 1.14). A test is created first (title, duration, topics with a question count each) and scheduled to
// a college's batches later. Questions are never picked by hand: each topic's count is split 50% hard / 30% medium /
// 20% easy, and every student gets random questions from those pools. Superadmin and onboarding managers can read and
// write tests; writes go through the `test_*` functions (the tables are read-only to the app). Nothing is deleted:
// tests are archived.

export const MIN_QUESTIONS_PER_TOPIC = 25;
export const MAX_QUESTIONS_PER_TOPIC = 100;
export const MIN_DURATION = 30;
export const MAX_DURATION = 180;
export const MAX_TOPICS = 20;

export interface TestTopic {
  category_id: string;
  sort_order: number;
  question_count: number;
  hard_count: number;
  medium_count: number;
  easy_count: number;
}

export interface Test {
  id: string;
  title: string;
  duration_minutes: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  topics: TestTopic[];
}

export interface Split {
  hard: number;
  medium: number;
  easy: number;
}

/**
 * 50% hard, 30% medium, 20% easy: each share rounded down, then what's left goes to hard first, then medium, so the
 * total always matches (25 -> 13 / 7 / 5). Mirrors `test_difficulty_split` in the database, which is what is saved.
 */
export function splitDifficulty(count: number): Split {
  const hard = Math.floor((count * 5) / 10);
  const medium = Math.floor((count * 3) / 10);
  const easy = Math.floor((count * 2) / 10);
  const left = count - hard - medium - easy;
  return { hard: hard + (left >= 1 ? 1 : 0), medium: medium + (left >= 2 ? 1 : 0), easy };
}

const TESTS_KEY = ["tests"] as const;

/** Every test, archived ones included, newest first, each with its topics in display order. */
export function useTests() {
  return useQuery({
    queryKey: TESTS_KEY,
    queryFn: async (): Promise<Test[]> => {
      const { data, error } = await supabase
        .from("tests")
        .select(
          "id, title, duration_minutes, created_at, updated_at, archived_at, " +
            "topics:test_topics(category_id, sort_order, question_count, hard_count, medium_count, easy_count)",
        )
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      const tests = data as unknown as Test[];
      for (const t of tests) t.topics.sort((a, b) => a.sort_order - b.sort_order);
      return tests;
    },
  });
}

export interface TopicInput {
  category_id: string;
  question_count: number;
}

export interface TestInput {
  title: string;
  duration_minutes: number;
  topics: TopicInput[];
}

const testSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(100, "Title can be at most 100 characters"),
  duration_minutes: z
    .number({ error: `Duration must be between ${MIN_DURATION} and ${MAX_DURATION} minutes` })
    .int(`Duration must be between ${MIN_DURATION} and ${MAX_DURATION} minutes`)
    .min(MIN_DURATION, `Duration must be between ${MIN_DURATION} and ${MAX_DURATION} minutes`)
    .max(MAX_DURATION, `Duration must be between ${MIN_DURATION} and ${MAX_DURATION} minutes`),
  topics: z
    .array(
      z.object({
        category_id: z.string().min(1, "Pick a topic for every row"),
        question_count: z
          .number({ error: `Each topic needs between ${MIN_QUESTIONS_PER_TOPIC} and ${MAX_QUESTIONS_PER_TOPIC} questions` })
          .int(`Each topic needs between ${MIN_QUESTIONS_PER_TOPIC} and ${MAX_QUESTIONS_PER_TOPIC} questions`)
          .min(MIN_QUESTIONS_PER_TOPIC, `Each topic needs between ${MIN_QUESTIONS_PER_TOPIC} and ${MAX_QUESTIONS_PER_TOPIC} questions`)
          .max(MAX_QUESTIONS_PER_TOPIC, `Each topic needs between ${MIN_QUESTIONS_PER_TOPIC} and ${MAX_QUESTIONS_PER_TOPIC} questions`),
      }),
    )
    .min(1, "Add at least one topic")
    .max(MAX_TOPICS, `A test can have at most ${MAX_TOPICS} topics`)
    .refine((topics) => new Set(topics.map((t) => t.category_id)).size === topics.length, "Each topic can be added only once"),
});

/** Eligible (approved, not archived) questions per difficulty for each topic, from its whole subtree. */
export type PoolSizes = Map<string, Split>;

/**
 * How many test-eligible questions each picked topic has, for the form's warnings. Takes category ids only (the split
 * is worked out locally); the database still raises for a list it would refuse to save, such as a topic together with
 * one of its own subtopics, and that message comes back as the query's error.
 */
export function usePoolSizes(categoryIds: string[]) {
  return useQuery({
    queryKey: ["test-pool-sizes", ...categoryIds],
    enabled: categoryIds.length > 0,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<PoolSizes> => {
      const topics = categoryIds.map((category_id) => ({ category_id, question_count: MIN_QUESTIONS_PER_TOPIC }));
      const { data, error } = await supabase.rpc("test_pool_status", { p_topics: topics });
      if (error) throw new Error(error.message);
      const rows = data as { category_id: string; hard_available: number; medium_available: number; easy_available: number }[];
      return new Map(rows.map((r) => [r.category_id, { hard: r.hard_available, medium: r.medium_available, easy: r.easy_available }]));
    },
  });
}

function useInvalidateTests() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: TESTS_KEY });
}

/** Creates a test and returns its id. The database refuses it if any pool is too small (TESTS.md 1.6). */
export function useCreateTest() {
  const invalidate = useInvalidateTests();
  return useMutation({
    mutationFn: async (input: TestInput): Promise<string> => {
      const t = parseOrThrow(testSchema, input);
      const { data, error } = await supabase.rpc("test_create", {
        p_title: t.title,
        p_duration_minutes: t.duration_minutes,
        p_topics: t.topics,
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: invalidate,
  });
}

/** Replaces the title, duration and whole topic list. Archived tests can't be edited. */
export function useUpdateTest() {
  const invalidate = useInvalidateTests();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: TestInput }) => {
      const t = parseOrThrow(testSchema, input);
      const { error } = await supabase.rpc("test_update", {
        p_test_id: id,
        p_title: t.title,
        p_duration_minutes: t.duration_minutes,
        p_topics: t.topics,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

export function useSetTestArchived() {
  const invalidate = useInvalidateTests();
  return useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const { error } = await supabase.rpc("test_set_archived", { p_test_id: id, p_archived: archived });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}
