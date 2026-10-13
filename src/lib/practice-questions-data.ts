import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  checkValue,
  type Language,
  LANGUAGES,
  newId,
  type PracticeQuestion,
  type ValueType,
  writtenLanguages,
} from "@/lib/practice-questions";

// Loads and saves Practice coding questions (pc_questions, pc_test_cases, pc_question_solutions; migration
// 20261012021155). Superadmin and content managers read everything, drafts, hidden cases and solutions included.
// Writes go through the pc_question_* database functions, which repeat every publish check.
//
// In the database a test case's inputs are a JSON list in parameter order ([2024]); the editor keeps one text box per
// parameter. Values that don't parse yet (drafts) are stored as the text the author typed.

const QUESTIONS_KEY = ["practice-questions"] as const;

interface QuestionRow {
  id: string;
  category_id: string;
  slug: string;
  title: string;
  difficulty: PracticeQuestion["difficulty"];
  topic: string;
  access: PracticeQuestion["access"];
  status: "draft" | "published";
  description: string;
  constraints: string;
  explanation: string;
  method: string;
  params: { name: string; type: ValueType }[];
  returns: ValueType;
  position: number;
  updated_at: string;
  archived_at: string | null;
}

interface TestCaseRow {
  question_id: string;
  position: number;
  visibility: "example" | "hidden";
  inputs: unknown[];
  expected: unknown;
  note: string;
}

interface SolutionRow {
  question_id: string;
  language: Language;
  code: string;
  passed_at: string | null;
}

/** A stored value as the editor's text: strings as typed, lists as [1, 2], anything unparsed as it was typed. */
export function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
  if (value === null || value === undefined) return "";
  return String(value);
}

/** The editor's text as the value to store: the parsed value, or the raw text while it doesn't parse. */
function toValue(type: ValueType, text: string): unknown {
  const c = checkValue(type, text);
  return c.ok ? c.value : text;
}

function fromRows(q: QuestionRow, cases: TestCaseRow[], solutions: SolutionRow[], categorySlug: string): PracticeQuestion {
  const params = q.params.map((p) => ({ id: newId(), name: p.name, type: p.type }));
  const mine = solutions.filter((s) => s.question_id === q.id);
  const first = LANGUAGES.find((l) => mine.some((s) => s.language === l.id))?.id ?? "python";
  return {
    id: q.id,
    category_slug: categorySlug,
    position: q.position,
    slug: q.slug,
    title: q.title,
    difficulty: q.difficulty,
    topic: q.topic,
    access: q.access,
    status: q.archived_at ? "archived" : q.status,
    description: q.description,
    constraints: q.constraints,
    explanation: q.explanation,
    method: q.method,
    params,
    returns: q.returns,
    test_cases: cases
      .filter((t) => t.question_id === q.id)
      .sort((a, b) => a.position - b.position)
      .map((t) => ({
        id: newId(),
        visibility: t.visibility,
        inputs: Object.fromEntries(params.map((p, i) => [p.id, toText(t.inputs[i])])),
        expected: toText(t.expected),
        note: t.note,
      })),
    solutions: Object.fromEntries(mine.map((s) => [s.language, s.code])),
    solution_language: first,
    solutions_passed: mine.filter((s) => s.passed_at !== null).map((s) => s.language),
    updated_at: q.updated_at,
  };
}

/** Every question (drafts and archived included), given the categories to map ids to slugs. */
export function usePracticeQuestions(categories: { id: string; slug: string }[] | undefined) {
  return useQuery({
    queryKey: QUESTIONS_KEY,
    enabled: categories !== undefined,
    queryFn: async (): Promise<PracticeQuestion[]> => {
      const [questions, cases, solutions] = await Promise.all([
        supabase
          .from("pc_questions")
          .select(
            "id, category_id, slug, title, difficulty, topic, access, status, description, constraints, explanation, method, params, returns, position, updated_at, archived_at",
          )
          .order("position"),
        supabase.from("pc_test_cases").select("question_id, position, visibility, inputs, expected, note"),
        supabase.from("pc_question_solutions").select("question_id, language, code, passed_at"),
      ]);
      if (questions.error) throw new Error(questions.error.message);
      if (cases.error) throw new Error(cases.error.message);
      if (solutions.error) throw new Error(solutions.error.message);
      const slugOf = new Map((categories ?? []).map((c) => [c.id, c.slug]));
      return (questions.data as QuestionRow[]).map((q) =>
        fromRows(q, cases.data as TestCaseRow[], solutions.data as SolutionRow[], slugOf.get(q.category_id) ?? ""),
      );
    },
  });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: QUESTIONS_KEY });
}

/** Reloads the question list, e.g. after an import saved many at once. */
export const useInvalidatePracticeQuestions = useInvalidate;

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

export interface SaveInput {
  /** Null for a new question. */
  id: string | null;
  categoryId: string;
  question: PracticeQuestion;
  /** Languages whose current solution passed every current test case in this session. */
  passing: Language[];
}

/** The pc_question_save arguments for a question. */
export function saveArgs({ id, categoryId, question: q, passing }: SaveInput) {
  return {
    p_question_id: id,
    p_category_id: categoryId,
    p_slug: q.slug,
    p_title: q.title,
    p_difficulty: q.difficulty,
    p_topic: q.topic,
    p_access: q.access,
    p_description: q.description,
    p_constraints: q.constraints,
    p_explanation: q.explanation,
    p_method: q.method,
    p_params: q.params.map((p) => ({ name: p.name, type: p.type })),
    p_returns: q.returns,
    p_test_cases: q.test_cases.map((t) => ({
      visibility: t.visibility,
      inputs: q.params.map((p) => toValue(p.type, t.inputs[p.id] ?? "")),
      expected: toValue(q.returns, t.expected),
      note: t.note,
    })),
    p_solutions: writtenLanguages(q).map((language) => ({
      language,
      code: q.solutions[language],
      passed: passing.includes(language),
    })),
  };
}

/** Saves the whole question (fields, test cases, solutions) and returns its id. */
export function useSaveQuestion() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: SaveInput) => (await rpc("pc_question_save", saveArgs(input))) as string,
    onSuccess: invalidate,
  });
}

/** Saves one question without reloading the list (for imports; reload once at the end). Returns its id. */
export async function saveQuestionNow(input: SaveInput): Promise<string> {
  return (await rpc("pc_question_save", saveArgs(input))) as string;
}

/** Publishes one question without reloading the list (for imports). */
export async function publishQuestionNow(id: string): Promise<void> {
  await rpc("pc_question_set_published", { p_question_id: id, p_published: true });
}

/** Publishes (refused with the problems if it isn't ready) or moves back to draft. */
export function useSetQuestionPublished() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, published }: { id: string; published: boolean }) =>
      rpc("pc_question_set_published", { p_question_id: id, p_published: published }),
    onSettled: invalidate,
  });
}

/** Archive (hidden from PrepCode) or restore as a draft. */
export function useSetQuestionArchived() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      rpc("pc_question_set_archived", { p_question_id: id, p_archived: archived }),
    onSuccess: invalidate,
  });
}

/** Every question id of the category (drafts and archived included) in the new order. */
export function useReorderQuestions() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ categoryId, ids }: { categoryId: string; ids: string[] }) =>
      rpc("pc_questions_reorder", { p_category_id: categoryId, p_question_ids: ids }),
    onSettled: invalidate,
  });
}
