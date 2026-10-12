import Papa from "papaparse";
import type { PcCategory, PcDomain } from "@/lib/practice";
import {
  checkValue,
  type Difficulty,
  emptyQuestion,
  type Language,
  LANGUAGES,
  nameProblem,
  newId,
  type PracticeQuestion,
  type TestCase,
  VALUE_TYPES,
  type ValueType,
  type Visibility,
} from "@/lib/practice-questions";
import type { Cell } from "@/lib/question-import";

// Bulk import of Practice coding questions from a .csv or .xlsx file (read with question-import's readImportFile).
// One question per row. Columns (any order, case-insensitive):
//   category, title, slug, difficulty, topic, access, description, constraints, explanation,
//   method, params, returns, examples, hidden, solution_python, solution_java, solution_cpp, solution_c, solution_csharp
//
// params: "name type" pairs separated by commas or semicolons, e.g. "nums int[], target int" (a colon is fine too).
// examples / hidden: one test case per line, "inputs => expected", values written as JSON in parameter order, with an
// optional "# note" after an example:
//   2024 => true
//   2000 => true # divisible by 400
//   [1, 2, 3], 5 => "found"

export const MAX_PRACTICE_IMPORT_ROWS = 200;

const REQUIRED_COLUMNS = ["category", "title", "difficulty", "method", "returns", "examples"];
const SOLUTION_COLUMNS = LANGUAGES.map((l) => `solution_${l.id}` as const);

export interface PracticeImportRow {
  /** Row number as seen in a spreadsheet (the header is row 1). */
  row: number;
  title: string;
  category: string;
  slug: string;
  examples: number;
  hidden: number;
  /** Languages with a solution in the file. */
  languages: Language[];
  error: string | null;
  question: PracticeQuestion | null;
}

export interface PracticeImportPreview {
  /** Set when the file as a whole can't be used (missing columns, too many rows, ...). */
  fileError: string | null;
  rows: PracticeImportRow[];
}

const cellText = (v: Cell): string => (v === null || v === undefined ? "" : String(v).replace(/\r\n/g, "\n").trim());
const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const normalizeHeader = (s: string) => normalize(s).replace(/[\s-]+/g, "_");

const DIFFICULTIES: Record<string, Difficulty> = { easy: "easy", medium: "medium", med: "medium", hard: "hard" };

function slugify(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
}

/** "nums int[], target int" → [{name, type}]; throws a readable message. */
function parseParams(text: string): { name: string; type: ValueType }[] {
  if (!text.trim()) return [];
  return text.split(/[,;\n]/).map((part) => {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:?\s*([a-z]+(?:\[\])?)\s*$/.exec(part);
    if (!m) throw new Error(`Write each parameter as "name type", e.g. "year int" (got "${part.trim()}")`);
    const type = m[2] as ValueType;
    if (!VALUE_TYPES.includes(type)) throw new Error(`"${m[2]}" isn't a supported type (use ${VALUE_TYPES.join(", ")})`);
    const problem = nameProblem(m[1]);
    if (problem) throw new Error(`Parameter "${m[1]}": ${problem}`);
    return { name: m[1], type };
  });
}

function tryJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * One test-case line: "inputs => expected # note". Every "=>" and "#" is tried in turn, so they may also appear inside
 * quoted strings.
 */
function parseCaseLine(line: string): { inputs: unknown[]; expected: unknown; note: string } {
  const arrows = [...line.matchAll(/=>/g)].map((m) => m.index!);
  if (arrows.length === 0) throw new Error(`Write each test case as "inputs => expected" (got "${line}")`);
  for (const at of arrows) {
    const inputs = tryJson(`[${line.slice(0, at)}]`);
    if (!inputs.ok || !Array.isArray(inputs.value)) continue;
    const rest = line.slice(at + 2).trim();
    const whole = tryJson(rest);
    if (whole.ok) return { inputs: inputs.value, expected: whole.value, note: "" };
    for (const hash of [...rest.matchAll(/#/g)].map((m) => m.index!)) {
      const expected = tryJson(rest.slice(0, hash).trim());
      if (expected.ok) return { inputs: inputs.value, expected: expected.value, note: rest.slice(hash + 1).trim() };
    }
  }
  throw new Error(`Couldn't read "${line}". Values are JSON: numbers, true/false, "text" in quotes, [lists]`);
}

/** A JSON value as the editor's text for its type (strings unquoted, lists as [1, 2]). */
function editorText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
  return String(value);
}

/** Turns rows read from a file (header first) into a checked preview. Pure: no I/O. */
export function buildPracticeImportPreview(
  table: Cell[][],
  domains: PcDomain[],
  categories: PcCategory[],
  existingSlugs: Set<string>,
): PracticeImportPreview {
  const fail = (fileError: string): PracticeImportPreview => ({ fileError, rows: [] });
  if (table.length === 0) return fail("The file is empty");

  const headers = table[0].map((h) => normalizeHeader(cellText(h)));
  const column = new Map<string, number>();
  for (const [i, h] of headers.entries()) {
    if (!h) continue;
    if (column.has(h)) return fail(`The column "${h}" appears more than once`);
    column.set(h, i);
  }
  const missing = REQUIRED_COLUMNS.filter((c) => !column.has(c));
  if (missing.length) return fail(`Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);

  const dataRows = table
    .slice(1)
    .map((cells, i) => ({ cells, row: i + 2 }))
    .filter(({ cells }) => cells.some((c) => cellText(c) !== ""));
  if (dataRows.length === 0) return fail("The file has no questions");
  if (dataRows.length > MAX_PRACTICE_IMPORT_ROWS) {
    return fail(`A file can hold at most ${MAX_PRACTICE_IMPORT_ROWS} questions (this one has ${dataRows.length})`);
  }

  // Categories by slug, by title (when unique) or as "Domain › Title"; active ones only.
  const domainTitle = new Map(domains.map((d) => [d.id, d.title]));
  const active = categories.filter((c) => !c.archived_at && !domains.find((d) => d.id === c.domain_id)?.archived_at);
  const lookup = new Map<string, PcCategory | "ambiguous">();
  for (const c of active) {
    lookup.set(normalize(c.slug), c);
    lookup.set(normalize(`${domainTitle.get(c.domain_id)} › ${c.title}`), c);
    const t = normalize(c.title);
    lookup.set(t, lookup.has(t) ? "ambiguous" : c);
  }
  const findCategory = (text: string) => lookup.get(normalize(text.replace(/\s*[>›»/]\s*/g, " › ")));

  const seenSlugs = new Map<string, number>();

  const rows = dataRows.map(({ cells, row }): PracticeImportRow => {
    const get = (name: string) => cellText(cells[column.get(name) ?? -1]);
    const title = get("title");
    const slug = (get("slug") || slugify(title)).toLowerCase();
    const categoryText = get("category");
    const languages = LANGUAGES.map((l) => l.id).filter((l) => get(`solution_${l}`) !== "");
    const base: PracticeImportRow = { row, title, category: categoryText, slug, examples: 0, hidden: 0, languages, error: null, question: null };

    try {
      if (!title) throw new Error("The title is required");
      const category = findCategory(categoryText);
      if (!categoryText) throw new Error("The category is required");
      if (category === "ambiguous") throw new Error(`"${categoryText}" matches more than one category; use its slug`);
      if (!category) throw new Error(`Unknown or archived category "${categoryText}"; use a category's slug, e.g. basics`);
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 64) {
        throw new Error(`The slug "${slug}" can only use lowercase letters, digits and single hyphens`);
      }
      if (existingSlugs.has(slug)) throw new Error(`A question with the slug "${slug}" already exists`);
      const first = seenSlugs.get(slug);
      if (first !== undefined) throw new Error(`Same slug as row ${first}`);
      seenSlugs.set(slug, row);

      const difficultyText = get("difficulty");
      const difficulty = DIFFICULTIES[normalize(difficultyText)];
      if (!difficulty) throw new Error(`Difficulty must be easy, medium or hard (got "${difficultyText}")`);
      const accessText = normalize(get("access") || "public");
      if (accessText !== "public" && accessText !== "private") throw new Error(`Access must be public or private (got "${get("access")}")`);

      const method = get("method");
      const methodProblem = nameProblem(method);
      if (methodProblem) throw new Error(`Method name: ${methodProblem}`);
      const returns = get("returns") as ValueType;
      if (!VALUE_TYPES.includes(returns)) throw new Error(`"returns" must be one of ${VALUE_TYPES.join(", ")} (got "${get("returns")}")`);
      const params = parseParams(get("params")).map((p) => ({ id: newId(), ...p }));

      const cases: TestCase[] = [];
      const readCases = (columnName: string, visibility: Visibility) => {
        for (const line of get(columnName).split("\n").map((l) => l.trim()).filter(Boolean)) {
          const c = parseCaseLine(line);
          const where = `${visibility === "example" ? "Example" : "Hidden case"} "${line}"`;
          if (c.inputs.length !== params.length) {
            throw new Error(`${where} has ${c.inputs.length} value${c.inputs.length === 1 ? "" : "s"}, the method takes ${params.length}`);
          }
          const inputs = Object.fromEntries(params.map((p, i) => [p.id, editorText(c.inputs[i])]));
          for (const p of params) {
            const checked = checkValue(p.type, inputs[p.id]);
            if (!checked.ok) throw new Error(`${where}: ${p.name} ${checked.error.toLowerCase()}`);
          }
          const expected = editorText(c.expected);
          const checked = checkValue(returns, expected);
          if (!checked.ok) throw new Error(`${where}: the expected value ${checked.error.toLowerCase()}`);
          cases.push({ id: newId(), visibility, inputs, expected, note: visibility === "example" ? c.note : "" });
        }
      };
      readCases("examples", "example");
      if (column.has("hidden")) readCases("hidden", "hidden");
      const examples = cases.filter((c) => c.visibility === "example").length;
      if (examples === 0) throw new Error("Add at least one example");

      const question: PracticeQuestion = {
        ...emptyQuestion(category.slug, 0),
        slug,
        title,
        difficulty,
        topic: get("topic"),
        access: accessText,
        description: get("description"),
        constraints: get("constraints"),
        explanation: get("explanation"),
        method,
        params,
        returns,
        test_cases: cases,
        solutions: Object.fromEntries(languages.map((l) => [l, get(`solution_${l}`) + "\n"])),
        solution_language: languages[0] ?? "python",
      };
      return { ...base, category: category.title, examples, hidden: cases.length - examples, question };
    } catch (err) {
      return { ...base, error: (err as Error).message };
    }
  });

  return { fileError: null, rows };
}

/** A ready-to-fill CSV with the columns and two example questions. */
export function practiceImportTemplateCsv(categorySlug: string): string {
  return Papa.unparse([
    [
      "category",
      "title",
      "slug",
      "difficulty",
      "topic",
      "access",
      "description",
      "constraints",
      "explanation",
      "method",
      "params",
      "returns",
      "examples",
      "hidden",
      ...SOLUTION_COLUMNS,
    ],
    [
      categorySlug,
      "Even or Odd",
      "even-or-odd",
      "easy",
      "Basics",
      "public",
      "**TokenDesk** prints a token for every customer... (the case study: at least 100 words to publish). Given `n`, return \"Even\" or \"Odd\".",
      "`-10⁹ ≤ n ≤ 10⁹`",
      "`n % 2 == 0` means even. In some languages `%` of a negative number is negative, so compare with 0, not 1.",
      "evenOrOdd",
      "n int",
      "string",
      '4 => "Even"\n7 => "Odd"\n0 => "Even" # 0 is even',
      '-3 => "Odd"\n1000000000 => "Even"',
      'class Solution:\n    def evenOrOdd(self, n: int) -> str:\n        return "Even" if n % 2 == 0 else "Odd"',
      'class Solution {\n    public String evenOrOdd(int n) {\n        return n % 2 == 0 ? "Even" : "Odd";\n    }\n}',
      "",
      "",
      "",
    ],
    [
      categorySlug,
      "Array Sum",
      "",
      "easy",
      "Arrays",
      "private",
      "A case study ending with: given `nums`, return the sum of its numbers.",
      "`0 ≤ nums.length ≤ 1000`",
      "",
      "arraySum",
      "nums int[]",
      "int",
      "[1, 2, 3] => 6\n[] => 0 # an empty list adds up to 0\n[-5, 5] => 0",
      "[100] => 100",
      "class Solution:\n    def arraySum(self, nums: list[int]) -> int:\n        return sum(nums)",
      "",
      "",
      "int arraySum(int* nums, int numsSize) {\n    int total = 0;\n    for (int i = 0; i < numsSize; i++) total += nums[i];\n    return total;\n}",
      "",
    ],
  ]);
}
