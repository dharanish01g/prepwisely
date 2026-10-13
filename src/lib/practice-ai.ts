import { FunctionsHttpError } from "@supabase/supabase-js";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toText } from "@/lib/practice-questions-data";
import {
  checkValue,
  type Difficulty,
  newId,
  type PracticeQuestion,
  VALUE_TYPES,
  type ValueType,
  type Visibility,
} from "@/lib/practice-questions";
import { runSolution } from "@/lib/solution-runner";

// Drafts a new Practice question with AI (the `practice-ai` Edge Function, Gemini) from what the author describes.
// The draft only fills the editor: nothing is saved, and the usual checks and solution run still apply before publishing.

/** What the function returns. Test case values are JSON text, in parameter order. */
interface GeneratedQuestion {
  title: string;
  slug: string;
  difficulty: Difficulty;
  topic: string;
  description: string;
  constraints: string;
  explanation: string;
  method: string;
  params: { name: string; type: string }[];
  returns: string;
  test_cases: { visibility: Visibility; inputs: string[]; expected: string; note?: string }[];
  solution_python: string;
}

/** The same limits as the function's (rules.ts). */
export const MIN_PROMPT = 10;
export const MAX_PROMPT = 2000;

const asType = (t: string): ValueType => ((VALUE_TYPES as readonly string[]).includes(t) ? (t as ValueType) : "int");

/**
 * A JSON-text value as the editor's text (strings without quotes, lists as [1, 2]). A string the AI forgot to quote
 * is kept as it came; anything else unparsable too, for the editor's checks to flag.
 */
function valueText(type: ValueType, json: string | undefined): string {
  if (json === undefined) return "";
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return json;
  }
  return type === "string" && typeof value !== "string" ? json : toText(value);
}

/**
 * The draft applied to the question being written. Keeps what isn't the AI's to decide: id, category, position,
 * access and status.
 */
export function applyGenerated(q: PracticeQuestion, g: GeneratedQuestion): PracticeQuestion {
  const params = (g.params ?? []).map((p) => ({ id: newId(), name: String(p.name ?? "").trim(), type: asType(p.type) }));
  const returns = asType(g.returns);
  return {
    ...q,
    title: g.title ?? "",
    slug: g.slug ?? "",
    difficulty: (["easy", "medium", "hard"] as const).includes(g.difficulty) ? g.difficulty : q.difficulty,
    topic: g.topic ?? "",
    description: g.description ?? "",
    constraints: g.constraints ?? "",
    explanation: g.explanation ?? "",
    method: String(g.method ?? "").trim(),
    params,
    returns,
    test_cases: (g.test_cases ?? []).map((t) => ({
      id: newId(),
      visibility: t.visibility === "hidden" ? "hidden" : "example",
      inputs: Object.fromEntries(params.map((p, i) => [p.id, valueText(p.type, t.inputs?.[i])])),
      expected: valueText(returns, t.expected),
      note: t.visibility === "hidden" ? "" : (t.note ?? ""),
    })),
    solutions: g.solution_python ? { python: g.solution_python } : {},
    solution_language: "python",
    solutions_passed: [],
  };
}

export function useGenerateQuestion() {
  return useMutation({
    mutationFn: async ({ categoryId, prompt }: { categoryId: string; prompt: string }): Promise<GeneratedQuestion> => {
      const { data, error } = await supabase.functions.invoke("practice-ai", { body: { category_id: categoryId, prompt } });
      if (error) {
        if (error instanceof FunctionsHttpError) {
          const payload = await error.context.json().catch(() => null);
          throw new Error(payload?.error ?? "Couldn't generate the question");
        }
        throw new Error(error.message);
      }
      return (data as { question: GeneratedQuestion }).question;
    },
  });
}

/** A valid stand-in for an expected value that doesn't parse, so the case still runs. */
const PLACEHOLDER: Record<ValueType, string> = { int: "0", long: "0", bool: "false", string: "", "int[]": "[]", "string[]": "[]" };

export interface ExpectedFix {
  question: PracticeQuestion;
  /** 1-based positions of the cases whose expected value now comes from the solution. */
  corrected: number[];
  /** Cases the solution failed on (an error or timeout), left as the AI wrote them. */
  errors: number[];
  compileError: string | null;
}

/**
 * Runs the draft's Python solution on this computer and sets every case's expected value to what it returns, since the
 * AI often gets the arithmetic of a case wrong while its solution is right. The author still reviews the solution.
 */
export async function fixExpectedValues(q: PracticeQuestion): Promise<ExpectedFix> {
  const runnable = {
    ...q,
    test_cases: q.test_cases.map((t) => (checkValue(q.returns, t.expected).ok ? t : { ...t, expected: PLACEHOLDER[q.returns] })),
  };
  const run = await runSolution(runnable, "python");
  if (run.compileError !== null) return { question: q, corrected: [], errors: [], compileError: run.compileError };
  const corrected: number[] = [];
  const errors: number[] = [];
  const test_cases = q.test_cases.map((t, i) => {
    const result = run.results[t.id];
    if (result?.status === "passed") {
      if (checkValue(q.returns, t.expected).ok) return t;
      // It only ran with the stand-in, and the solution returned exactly that.
      corrected.push(i + 1);
      return { ...t, expected: runnable.test_cases[i].expected };
    }
    if (result?.status === "failed") {
      const expected = valueText(q.returns, result.got);
      if (checkValue(q.returns, expected).ok) {
        corrected.push(i + 1);
        return { ...t, expected };
      }
    }
    errors.push(i + 1);
    return t;
  });
  return { question: { ...q, test_cases }, corrected, errors, compileError: null };
}
