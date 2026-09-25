import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import type { Cell } from "@/lib/question-import";
import { supabase } from "@/lib/supabase";

// Students of a batch. Accounts are created, reset and (de)activated only through the `college-users` Edge Function
// (superadmin, or the college's assigned onboarding manager); the table itself is read-only to the app. A student
// signs in with their email; their first password is their batch code without dashes (SEC-CSE-2028-B01 gives
// SECCSE2028B01), and changing it later is up to them.

export interface Student {
  id: string;
  batch_id: string;
  full_name: string;
  email: string;
  roll_number: string;
  /** Optional: colleges may not share students' personal numbers. */
  phone: string | null;
  status: "active" | "inactive";
  created_at: string;
}

const STUDENT_COLUMNS = "id, batch_id, full_name, email, roll_number, phone, status, created_at";
const studentsKey = (batchId: string) => ["students", batchId];
const countsKey = (collegeId: string) => ["student-counts", collegeId];

export function useBatchStudents(batchId: string) {
  return useQuery({
    queryKey: studentsKey(batchId),
    queryFn: async (): Promise<Student[]> => {
      const { data, error } = await supabase.from("students").select(STUDENT_COLUMNS).eq("batch_id", batchId).order("roll_number");
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

/** Active students per batch in a college, for the batch drawer's count. */
export function useStudentCounts(collegeId: string) {
  return useQuery({
    queryKey: countsKey(collegeId),
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await supabase.from("students").select("batch_id").eq("college_id", collegeId).eq("status", "active");
      if (error) throw new Error(error.message);
      const counts = new Map<string, number>();
      for (const s of data) counts.set(s.batch_id, (counts.get(s.batch_id) ?? 0) + 1);
      return counts;
    },
  });
}

/** An import the server refused, with its problems by spreadsheet row. */
export class ImportRejected extends Error {
  constructor(
    message: string,
    readonly rowErrors: { row: number; message: string }[],
  ) {
    super(message);
  }
}

// Calls the `college-users` Edge Function and surfaces its error message (and per-row errors for an import).
async function callCollegeUsers(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("college-users", { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null);
      if (Array.isArray(payload?.errors)) throw new ImportRejected(payload.error ?? "Import failed", payload.errors);
      throw new Error(payload?.error ?? "Request failed");
    }
    throw new Error(error.message);
  }
  return data;
}

export interface StudentInput {
  full_name: string;
  email: string;
  roll_number: string;
  phone: string;
}

// Same rules as the Edge Function, so most problems show before anything is sent.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ROLL_LENGTH = 30;

/** A batch's starting (and reset) password: its code without dashes. Mirrors the Edge Function. */
export const batchPassword = (batchCode: string) => batchCode.replace(/-/g, "");
export const MAX_STUDENT_IMPORT_ROWS = 500;

function clean(input: StudentInput): StudentInput {
  return {
    full_name: input.full_name.trim(),
    email: input.email.trim().toLowerCase(),
    roll_number: input.roll_number.trim(),
    phone: input.phone.trim(),
  };
}

/** The first problem with one student's details, or null. */
export function studentProblem(input: StudentInput): string | null {
  const s = clean(input);
  if (!s.full_name) return "Full name is required";
  if (!EMAIL_RE.test(s.email)) return "A valid email is required";
  if (!s.roll_number) return "Roll number is required";
  if (s.roll_number.length > MAX_ROLL_LENGTH) return `Roll number can be at most ${MAX_ROLL_LENGTH} characters`;
  return null;
}

function useInvalidateStudents(batchId: string, collegeId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: studentsKey(batchId) });
    void queryClient.invalidateQueries({ queryKey: countsKey(collegeId) });
  };
}

export function useAddStudent(batchId: string, collegeId: string) {
  const invalidate = useInvalidateStudents(batchId, collegeId);
  return useMutation({
    mutationFn: async (input: StudentInput) => {
      const problem = studentProblem(input);
      if (problem) throw new Error(problem);
      await callCollegeUsers({ action: "create", batch_id: batchId, ...clean(input) });
    },
    onSuccess: invalidate,
  });
}

/** All or nothing: the server checks every row first and creates nothing if any row has a problem. */
export function useImportStudents(batchId: string, collegeId: string) {
  const invalidate = useInvalidateStudents(batchId, collegeId);
  return useMutation({
    mutationFn: async (rows: (StudentInput & { row: number })[]): Promise<number> => {
      const data = await callCollegeUsers({
        action: "import",
        batch_id: batchId,
        students: rows.map((r) => ({ row: r.row, ...clean(r) })),
      });
      return (data as { created: number }).created;
    },
    onSuccess: invalidate,
  });
}

/** Sets the student's password back to their batch code without dashes. */
export function useResetStudentPassword() {
  return useMutation({
    mutationFn: async (studentId: string) => {
      await callCollegeUsers({ action: "reset_password", student_id: studentId });
    },
  });
}

export function useSetStudentStatus(batchId: string, collegeId: string) {
  const invalidate = useInvalidateStudents(batchId, collegeId);
  return useMutation({
    mutationFn: async ({ studentId, status }: { studentId: string; status: Student["status"] }) => {
      await callCollegeUsers({ action: "set_status", student_id: studentId, status });
    },
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Import file: one student per row. Columns (any order, case-insensitive): full_name, email, roll_number, and an
// optional phone column (blank cells are fine).
// ---------------------------------------------------------------------------------------------------------------

const REQUIRED_COLUMNS = ["full_name", "email", "roll_number"] as const;

export interface StudentImportRow extends StudentInput {
  /** Row number as seen in a spreadsheet (the header is row 1). */
  row: number;
  error: string | null;
}

export interface StudentImportPreview {
  /** Set when the file as a whole can't be used (missing columns, too many rows, ...). */
  fileError: string | null;
  rows: StudentImportRow[];
}

const cellText = (v: Cell): string => (v === null || v === undefined ? "" : String(v).trim());
const normalizeHeader = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, "_");

/** Turns rows read from a file (header first) into a checked preview. Pure: no I/O. */
export function buildStudentImportPreview(table: Cell[][]): StudentImportPreview {
  const fail = (fileError: string): StudentImportPreview => ({ fileError, rows: [] });
  if (table.length === 0) return fail("The file is empty");

  const column = new Map<string, number>();
  for (const [i, h] of table[0].map((c) => normalizeHeader(cellText(c))).entries()) {
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
  if (dataRows.length === 0) return fail("The file has no students");
  if (dataRows.length > MAX_STUDENT_IMPORT_ROWS) {
    return fail(`A file can hold at most ${MAX_STUDENT_IMPORT_ROWS} students (this one has ${dataRows.length})`);
  }

  const seenEmails = new Map<string, number>();
  const seenRolls = new Map<string, number>();
  const rows = dataRows.map(({ cells, row }): StudentImportRow => {
    const get = (name: string) => cellText(cells[column.get(name) ?? -1]);
    const input = clean({ full_name: get("full_name"), email: get("email"), roll_number: get("roll_number"), phone: get("phone") });
    const rollKey = input.roll_number.toLowerCase();
    const error =
      studentProblem(input) ??
      (seenEmails.has(input.email) ? `Same email as row ${seenEmails.get(input.email)}` : null) ??
      (seenRolls.has(rollKey) ? `Same roll number as row ${seenRolls.get(rollKey)}` : null);
    if (input.email && !seenEmails.has(input.email)) seenEmails.set(input.email, row);
    if (rollKey && !seenRolls.has(rollKey)) seenRolls.set(rollKey, row);
    return { row, ...input, error };
  });

  return { fileError: null, rows };
}

/** The CSV template: the header plus two example rows. */
export function studentTemplateCsv(): string {
  return [
    "full_name,email,roll_number,phone",
    "Priya Raman,priya.raman@example.com,21CSE0045,9876543210",
    "Arun Kumar,arun.kumar@example.com,21CSE0046,",
  ].join("\r\n");
}
