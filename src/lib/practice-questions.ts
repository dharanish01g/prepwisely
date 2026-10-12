// PrepCode Practice coding questions (PRACTICE.md §2, step 2). The rules follow PrepCode's question-structure.md:
// a method with typed parameters and a return type, and test cases as values per parameter plus the expected result.
// This file is the editor's model and checks; practice-questions-data.ts loads and saves it (pc_questions and friends).

export type Difficulty = "easy" | "medium" | "hard";
export type Access = "public" | "private";
export type QuestionStatus = "draft" | "published" | "archived";
export type Visibility = "example" | "hidden";

/** The only types PrepCode supports today (question-structure.md §3.4). */
export const VALUE_TYPES = ["int", "long", "bool", "string", "int[]", "string[]"] as const;
export type ValueType = (typeof VALUE_TYPES)[number];

export const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

export interface Param {
  /** Local id, so renaming a parameter keeps its test-case values. */
  id: string;
  name: string;
  type: ValueType;
}

/** A test case as typed in the editor: one raw text per parameter (by param id) and for the expected value. */
export interface TestCase {
  id: string;
  visibility: Visibility;
  inputs: Record<string, string>;
  expected: string;
  note: string;
}

export interface PracticeQuestion {
  id: string;
  /** A pc_categories slug. */
  category_slug: string;
  position: number;
  slug: string;
  title: string;
  difficulty: Difficulty;
  topic: string;
  access: Access;
  status: QuestionStatus;
  description: string;
  constraints: string;
  explanation: string;
  method: string;
  params: Param[];
  returns: ValueType;
  test_cases: TestCase[];
  /**
   * Reference solutions, one per language, all optional; at least one is needed, and every one written must pass
   * every test case before publishing. Students never see them.
   */
  solutions: Partial<Record<Language, string>>;
  /** The language the editor shows (and Run uses). */
  solution_language: Language;
  /** Languages whose saved solution passed every saved test case (pc_question_solutions.passed_at). */
  solutions_passed: Language[];
  updated_at: string;
}

export function newId(): string {
  return crypto.randomUUID();
}

export function emptyQuestion(categorySlug: string, position: number): PracticeQuestion {
  return {
    id: newId(),
    category_slug: categorySlug,
    position,
    slug: "",
    title: "",
    difficulty: "easy",
    topic: "",
    access: "public",
    status: "draft",
    description: "",
    constraints: "",
    explanation: "",
    method: "",
    params: [{ id: newId(), name: "", type: "int" }],
    returns: "int",
    test_cases: [],
    solutions: {},
    solution_language: "python",
    solutions_passed: [],
    updated_at: new Date().toISOString(),
  };
}

export function emptyTestCase(params: Param[], visibility: Visibility): TestCase {
  return { id: newId(), visibility, inputs: Object.fromEntries(params.map((p) => [p.id, ""])), expected: "", note: "" };
}

// ---------------------------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------------------------

const INT_MIN = -2147483648n;
const INT_MAX = 2147483647n;
/** ±(2⁵³−1): PrepCode reads JSON numbers as JavaScript numbers (question-structure.md §3.5). */
const LONG_MAX = 9007199254740991n;

type Checked = { ok: true; value: unknown } | { ok: false; error: string };

function wholeNumber(text: string, type: "int" | "long"): Checked {
  const t = text.trim();
  if (!/^-?\d+$/.test(t)) return { ok: false, error: "Must be a whole number" };
  const n = BigInt(t);
  const [min, max] = type === "int" ? [INT_MIN, INT_MAX] : [-LONG_MAX, LONG_MAX];
  if (n < min || n > max) return { ok: false, error: type === "int" ? "Out of int range (±2,147,483,647)" : "Out of long range (±2⁵³−1)" };
  return { ok: true, value: Number(n) };
}

function hasLineBreak(s: string) {
  return /[\r\n]/.test(s);
}

/**
 * Checks what was typed for a value of `type`. Strings are typed as-is (no quotes); lists are JSON, e.g. [1, 2, 3]
 * or ["a", "b"]. Returns the JSON value PrepCode receives.
 */
export function checkValue(type: ValueType, text: string): Checked {
  switch (type) {
    case "int":
    case "long":
      return text.trim() === "" ? { ok: false, error: "Required" } : wholeNumber(text, type);
    case "bool":
      return text === "true" || text === "false" ? { ok: true, value: text === "true" } : { ok: false, error: "Choose true or false" };
    case "string":
      return hasLineBreak(text) ? { ok: false, error: "Can't contain a line break" } : { ok: true, value: text };
    case "int[]":
    case "string[]": {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { ok: false, error: type === "int[]" ? "Write a list like [1, 2, 3]" : 'Write a list like ["a", "b"]' };
      }
      if (!Array.isArray(parsed)) return { ok: false, error: "Must be a list in [ ]" };
      for (const item of parsed) {
        if (type === "int[]") {
          if (typeof item !== "number") return { ok: false, error: "Every item must be a whole number" };
          const c = wholeNumber(String(item), "int");
          if (!c.ok || !Number.isInteger(item)) return { ok: false, error: c.ok ? "Every item must be a whole number" : c.error };
        } else {
          if (typeof item !== "string") return { ok: false, error: "Every item must be a string in quotes" };
          if (hasLineBreak(item)) return { ok: false, error: "Strings can't contain a line break" };
        }
      }
      return { ok: true, value: parsed };
    }
  }
}

/** The value as the student sees it in an example: JSON, e.g. 2024, true, "abc", [1,2]. */
export function shownValue(type: ValueType, text: string): string {
  const c = checkValue(type, text);
  return c.ok ? JSON.stringify(c.value) : "?";
}

export const VALUE_PLACEHOLDER: Record<ValueType, string> = {
  int: "e.g. 42",
  long: "e.g. 3628800",
  bool: "",
  string: "text, no quotes",
  "int[]": "[1, 2, 3]",
  "string[]": '["a", "b"]',
};

// ---------------------------------------------------------------------------------------------------------------
// Names and publish checks
// ---------------------------------------------------------------------------------------------------------------

const NAME_RE = /^[a-z][A-Za-z0-9]*$/;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Keywords and C library names to avoid (question-structure.md §3.2). */
const RESERVED = new Set(
  (
    "class new delete default int char string function var return main print len type func go select range map struct " +
    "abs exit printf strlen max min pow sqrt index time free malloc"
  ).split(" "),
);

/** Why a method or parameter name can't be used, or null when it's fine. */
export function nameProblem(name: string): string | null {
  if (!name) return "Required";
  if (!NAME_RE.test(name)) return "camelCase, starting with a lowercase letter (e.g. isLeapYear)";
  if (RESERVED.has(name)) return `"${name}" is a keyword or built-in name in one of PrepCode's languages`;
  return null;
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export interface Check {
  label: string;
  ok: boolean;
}

export const MIN_WORDS = 100;
export const MIN_EXAMPLES = 3;

/** Everything that must hold before a question is published. */
/** The languages that have a solution written (more than the starter code). */
export function writtenLanguages(q: PracticeQuestion): Language[] {
  return LANGUAGES.map((l) => l.id).filter((l) => {
    const code = q.solutions[l]?.trim();
    return !!code && code !== starterCode(q, l).trim();
  });
}

/** `passing`: the languages whose solution passed every test case in its latest run. */
export function publishChecks(q: PracticeQuestion, passing: Language[]): Check[] {
  const written = writtenLanguages(q);
  const words = wordCount(q.description);
  const examples = q.test_cases.filter((t) => t.visibility === "example").length;
  const names = q.params.map((p) => p.name);
  const paramsOk =
    q.params.every((p) => nameProblem(p.name) === null && !/^_?pc/.test(p.name)) &&
    new Set(names).size === names.length &&
    !q.params.some((p) => p.type.endsWith("[]") && names.includes(`${p.name}Size`)) &&
    !names.includes(q.method);
  const casesOk = q.test_cases.length > 0 && q.test_cases.every((t) => testCaseErrors(q, t).length === 0);
  return [
    { label: "Title, topic and category are filled in", ok: q.title.trim() !== "" && q.topic.trim() !== "" && q.category_slug !== "" },
    { label: "Slug uses lowercase letters, digits and single hyphens", ok: SLUG_RE.test(q.slug) && q.slug.length <= 64 },
    { label: `Case study has at least ${MIN_WORDS} words (${words})`, ok: words >= MIN_WORDS },
    { label: "Constraints are filled in", ok: q.constraints.trim() !== "" },
    { label: "Method name is valid", ok: nameProblem(q.method) === null },
    { label: "Parameter names are valid and unique", ok: paramsOk },
    { label: `At least ${MIN_EXAMPLES} examples (${examples})`, ok: examples >= MIN_EXAMPLES },
    { label: "Every test case matches the method", ok: casesOk },
    {
      label: written.length
        ? `Every solution passes every test case (${written.filter((l) => passing.includes(l)).length} of ${written.length})`
        : "At least one solution is written",
      ok: written.length > 0 && written.every((l) => passing.includes(l)),
    },
  ];
}

/** Problems with one test case: "year: Must be a whole number", ... */
export function testCaseErrors(q: PracticeQuestion, t: TestCase): string[] {
  const errors: string[] = [];
  for (const p of q.params) {
    const c = checkValue(p.type, t.inputs[p.id] ?? "");
    if (!c.ok) errors.push(`${p.name || "parameter"}: ${c.error}`);
  }
  const e = checkValue(q.returns, t.expected);
  if (!e.ok) errors.push(`expected: ${e.error}`);
  return errors;
}

// ---------------------------------------------------------------------------------------------------------------
// Languages and starter code (as PrepCode's drivers.ts generates it)
// ---------------------------------------------------------------------------------------------------------------

/** The languages a solution can be written in; ids match the Rust `runtime_status` command. */
export const LANGUAGES = [
  { id: "python", label: "Python" },
  { id: "java", label: "Java" },
  { id: "cpp", label: "C++" },
  { id: "c", label: "C" },
  { id: "csharp", label: "C#" },
] as const;
export type Language = (typeof LANGUAGES)[number]["id"];

export function languageLabel(id: Language): string {
  return LANGUAGES.find((l) => l.id === id)?.label ?? id;
}

const JAVA: Record<ValueType, string> = { int: "int", long: "long", bool: "boolean", string: "String", "int[]": "int[]", "string[]": "String[]" };
const PYTHON: Record<ValueType, string> = { int: "int", long: "int", bool: "bool", string: "str", "int[]": "list[int]", "string[]": "list[str]" };
const CS: Record<ValueType, string> = { int: "int", long: "long", bool: "bool", string: "string", "int[]": "int[]", "string[]": "string[]" };
const CPP_PARAM: Record<ValueType, string> = {
  int: "int",
  long: "long long",
  bool: "bool",
  string: "string",
  "int[]": "vector<int>&",
  "string[]": "vector<string>&",
};
const CPP_RETURN: Record<ValueType, string> = { ...CPP_PARAM, "int[]": "vector<int>", "string[]": "vector<string>" };
const C_SCALAR: Record<string, string> = { int: "int", long: "long long", bool: "bool", string: "char*" };

const isList = (t: ValueType) => t === "int[]" || t === "string[]";

export function starterCode(q: Pick<PracticeQuestion, "method" | "params" | "returns">, language: Language): string {
  const method = q.method || "methodName";
  const params = q.params.map((p, i) => ({ name: p.name || `arg${i + 1}`, type: p.type }));
  switch (language) {
    case "java":
      return `class Solution {\n    public ${JAVA[q.returns]} ${method}(${params.map((p) => `${JAVA[p.type]} ${p.name}`).join(", ")}) {\n        // Write your code here\n\n    }\n}\n`;
    case "python":
      return `class Solution:\n    def ${method}(${["self", ...params.map((p) => `${p.name}: ${PYTHON[p.type]}`)].join(", ")}) -> ${PYTHON[q.returns]}:\n        # Write your code here\n        pass\n`;
    case "cpp":
      return `class Solution {\npublic:\n    ${CPP_RETURN[q.returns]} ${method}(${params.map((p) => `${CPP_PARAM[p.type]} ${p.name}`).join(", ")}) {\n        // Write your code here\n\n    }\n};\n`;
    case "csharp": {
      const pascal = method[0].toUpperCase() + method.slice(1);
      return `public class Solution {\n    public ${CS[q.returns]} ${pascal}(${params.map((p) => `${CS[p.type]} ${p.name}`).join(", ")}) {\n        // Write your code here\n\n    }\n}\n`;
    }
    case "c": {
      // C has no arrays with a length: they come with a size, and a returned array sets *returnSize.
      const list = params.flatMap(({ name, type }) =>
        type === "int[]" ? [`int* ${name}`, `int ${name}Size`] : type === "string[]" ? [`char** ${name}`, `int ${name}Size`] : [`${C_SCALAR[type]} ${name}`],
      );
      if (isList(q.returns)) list.push("int* returnSize");
      const ret = q.returns === "int[]" ? "int*" : q.returns === "string[]" ? "char**" : C_SCALAR[q.returns];
      const note = isList(q.returns) ? "    // Return a malloc'd array, and set *returnSize to its length.\n" : "";
      return `${ret} ${method}(${list.join(", ")}) {\n${note}    // Write your code here\n\n}\n`;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Checking test cases against the solution
// ---------------------------------------------------------------------------------------------------------------

/**
 * What a result was run for: the solution, the method and the case. A result counts only while all of these are
 * unchanged, so editing any of them asks for a new run.
 */
export function runKey(q: PracticeQuestion, t: TestCase, language: Language): string {
  return JSON.stringify([language, q.solutions[language] ?? "", q.method, q.params, q.returns, t.inputs, t.expected]);
}

/** What running the solution on one test case gave. */
export type CaseResult =
  | { status: "passed" }
  | { status: "failed"; got: string }
  | { status: "error"; message: string };
