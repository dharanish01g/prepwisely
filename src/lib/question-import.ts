import Papa from "papaparse";
import { readSheet } from "read-excel-file/browser";
import { submitSchema } from "@/lib/question-schema";

// One row per question. Columns (any order, case-insensitive):
//   title, description, category, difficulty, correct, option_1, explanation_1, option_2, explanation_2, ...
// More option_N / explanation_N pairs can be added freely; empty pairs are skipped.

export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

const REQUIRED_COLUMNS = ["title", "description", "category", "difficulty", "correct", "option_1", "explanation_1", "option_2", "explanation_2"];

export type Cell = string | number | boolean | Date | null | undefined;

export interface CategoryChoice {
  id: string;
  slug: string;
  name: string;
  /** Ancestors plus its own name, e.g. "Aptitude › Algebra". */
  path: string;
}

/** What gets sent to the import_questions database function. */
export interface ImportQuestion {
  row: number;
  title: string;
  description: string;
  category_id: string;
  difficulty: "easy" | "medium" | "hard";
  options: { body: string; explanation: string; is_correct: boolean }[];
}

export interface ImportRow {
  /** Row number as seen in a spreadsheet (the header is row 1). */
  row: number;
  title: string;
  category: string;
  difficulty: string;
  optionCount: number;
  error: string | null;
  question: ImportQuestion | null;
}

export interface ImportPreview {
  /** Set when the file as a whole can't be used (missing columns, too many rows, ...). */
  fileError: string | null;
  rows: ImportRow[];
}

const cellText = (v: Cell): string => (v === null || v === undefined ? "" : String(v).trim());
const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const normalizeHeader = (s: string) => normalize(s).replace(/[\s-]+/g, "_");
const normalizePath = (s: string) => normalize(s.replace(/\s*[>›»/]\s*/g, " › "));

const DIFFICULTY_ALIASES: Record<string, ImportQuestion["difficulty"]> = {
  easy: "easy",
  medium: "medium",
  med: "medium",
  hard: "hard",
};

/** Turns rows read from a file (header first) into a validated preview. Pure: no I/O. */
export function buildImportPreview(table: Cell[][], categories: CategoryChoice[]): ImportPreview {
  const fail = (fileError: string): ImportPreview => ({ fileError, rows: [] });

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

  let lastOption = 0;
  for (const h of headers) {
    const m = /^(?:option|explanation)_(\d+)$/.exec(h);
    if (m) lastOption = Math.max(lastOption, Number(m[1]));
  }

  const dataRows = table.slice(1).map((cells, i) => ({ cells, row: i + 2 })).filter(({ cells }) => cells.some((c) => cellText(c) !== ""));
  if (dataRows.length === 0) return fail("The file has no questions");
  if (dataRows.length > MAX_IMPORT_ROWS) {
    return fail(`A file can hold at most ${MAX_IMPORT_ROWS} questions (this one has ${dataRows.length})`);
  }

  const bySlug = new Map(categories.map((c) => [normalize(c.slug), c]));
  const byPath = new Map(categories.map((c) => [normalizePath(c.path), c]));
  const byName = new Map<string, CategoryChoice[]>();
  for (const c of categories) byName.set(normalize(c.name), [...(byName.get(normalize(c.name)) ?? []), c]);

  function resolveCategory(text: string): { category: CategoryChoice } | { error: string } {
    if (!text) return { error: "The category is required" };
    const hit = bySlug.get(normalize(text)) ?? byPath.get(normalizePath(text));
    if (hit) return { category: hit };
    const named = byName.get(normalize(text)) ?? [];
    if (named.length === 1) return { category: named[0] };
    if (named.length > 1) return { error: `"${text}" matches more than one category; use its slug or full path` };
    return { error: `Unknown category "${text}"; use a category's slug or full path` };
  }

  const seen = new Map<string, number>();

  const rows = dataRows.map(({ cells, row }): ImportRow => {
    const get = (name: string) => cellText(cells[column.get(name) ?? -1]);
    const title = get("title");
    const description = get("description");
    const categoryText = get("category");
    const difficultyText = get("difficulty");
    const correctText = get("correct");

    const options: { n: number; body: string; explanation: string }[] = [];
    for (let n = 1; n <= lastOption; n++) {
      const body = get(`option_${n}`);
      const explanation = get(`explanation_${n}`);
      if (body || explanation) options.push({ n, body, explanation });
    }

    const resolved = resolveCategory(categoryText);
    const difficulty = DIFFICULTY_ALIASES[normalize(difficultyText)];

    // The correct column is a 1-based option number or a letter (A = option 1), matching the file's column numbers.
    let correctN: number | null = null;
    if (/^\d+$/.test(correctText)) correctN = Number(correctText);
    else if (/^[a-z]$/i.test(correctText)) correctN = correctText.toLowerCase().charCodeAt(0) - 96;

    const problem =
      (!title && "The title is required") ||
      (!description && "The description is required") ||
      ("error" in resolved && resolved.error) ||
      (!difficultyText && "The difficulty is required") ||
      (!difficulty && `Difficulty must be easy, medium or hard (got "${difficultyText}")`) ||
      (options.length < 2 && "A question needs at least 2 options") ||
      options.map((o) => (!o.body ? `Option ${o.n} needs text` : !o.explanation ? `Option ${o.n} needs an explanation` : "")).find(Boolean) ||
      (!correctText && 'Say which option is correct (the "correct" column)') ||
      (correctN === null && `The correct column must be an option number or letter (got "${correctText}")`) ||
      (!options.some((o) => o.n === correctN) && `Option ${correctText} is marked correct but doesn't exist`) ||
      null;

    let error = problem || null;
    let question: ImportQuestion | null = null;

    if (!error && "category" in resolved && difficulty) {
      const candidate = {
        title,
        description,
        category_id: resolved.category.id,
        difficulty,
        options: options.map((o) => ({ id: String(o.n), body: o.body, explanation: o.explanation, is_correct: o.n === correctN })),
      };
      // Safety net: the same schema the editor uses to submit, so an import can never hold a question the editor would refuse.
      const parsed = submitSchema.safeParse(candidate);
      if (!parsed.success) {
        error = parsed.error.issues[0].message;
      } else {
        const key = `${normalize(title)}\n${normalize(description)}`;
        const first = seen.get(key);
        if (first !== undefined) error = `Duplicate of row ${first}`;
        else {
          seen.set(key, row);
          question = {
            row,
            title: parsed.data.title,
            description: parsed.data.description,
            category_id: parsed.data.category_id,
            difficulty: parsed.data.difficulty,
            options: parsed.data.options.map(({ body, explanation, is_correct }) => ({ body, explanation, is_correct })),
          };
        }
      }
    }

    return {
      row,
      title,
      category: "category" in resolved ? resolved.category.path : categoryText,
      difficulty: difficulty ?? difficultyText,
      optionCount: options.length,
      error,
      question,
    };
  });

  return { fileError: null, rows };
}

/** Reads a .csv or .xlsx file into rows of cells. Throws an Error with a message fit to show. */
export async function readImportFile(file: File): Promise<Cell[][]> {
  if (file.size > MAX_IMPORT_FILE_BYTES) throw new Error("That file is too large (5 MB at most)");
  const name = file.name.toLowerCase();

  if (name.endsWith(".xlsx")) {
    try {
      return (await readSheet(file)) as Cell[][];
    } catch {
      throw new Error("Couldn't read that Excel file. Make sure it is a valid .xlsx");
    }
  }
  if (name.endsWith(".csv")) {
    // Blank lines are kept so row numbers match what the creator sees in a spreadsheet.
    const result = Papa.parse<string[]>((await file.text()).replace(/^﻿/, ""), { skipEmptyLines: false });
    if (result.errors.some((e) => e.type === "Quotes")) throw new Error("That CSV file is malformed (check for unclosed quotes)");
    return result.data;
  }
  if (name.endsWith(".xls")) throw new Error("Old .xls files aren't supported. Save it as .xlsx or .csv");
  throw new Error("Unsupported file. Choose a .csv or .xlsx file");
}

/** A ready-to-fill CSV showing the expected columns, with two example questions. */
export function importTemplateCsv(exampleCategory: string): string {
  return Papa.unparse([
    ["title", "description", "category", "difficulty", "correct", "option_1", "explanation_1", "option_2", "explanation_2", "option_3", "explanation_3"],
    [
      "Sum of two numbers",
      "What is **2 + 2**?",
      exampleCategory,
      "easy",
      "B",
      "3",
      "Off by one.",
      "4",
      "Two plus two is four.",
      "5",
      "Off by one in the other direction.",
    ],
    [
      "Square root",
      "What is the square root of 81?",
      exampleCategory,
      "medium",
      "1",
      "9",
      "9 x 9 = 81.",
      "8",
      "8 x 8 = 64.",
      "",
      "",
    ],
  ]);
}
