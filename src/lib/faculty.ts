import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { callCollegeUsers } from "@/lib/students";
import { MIN_PASSWORD_LENGTH } from "@/lib/validation";

// Faculty of a college. Accounts are created, edited, reset, (de)activated and assigned only through the
// `college-users` Edge Function (superadmin, or the college's assigned onboarding manager); the tables are read-only
// to the app. Each faculty member gets a locked faculty ID (college code + F + 3 characters, e.g. SEC-F7K2) and signs
// in with their email and a password the manager hands them. Department and current role are optional and always
// picked from linked records (the college's departments, the faculty role list).

export interface Faculty {
  id: string;
  college_id: string;
  code: string;
  full_name: string;
  email: string;
  phone: string | null;
  department_id: string | null;
  faculty_role_id: string | null;
  status: "active" | "inactive";
  created_at: string;
}

export interface FacultyRole {
  id: string;
  label: string;
  is_active: boolean;
}

const FACULTY_COLUMNS = "id, college_id, code, full_name, email, phone, department_id, faculty_role_id, status, created_at";
const facultyKey = (collegeId: string) => ["faculty", collegeId];
const assignmentsKey = (collegeId: string) => ["faculty-assignments", collegeId];

export function useCollegeFaculty(collegeId: string | null) {
  return useQuery({
    queryKey: facultyKey(collegeId ?? ""),
    enabled: collegeId !== null,
    queryFn: async (): Promise<Faculty[]> => {
      const { data, error } = await supabase.from("faculty").select(FACULTY_COLUMNS).eq("college_id", collegeId!).order("full_name");
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

/** Current (not ended) batch assignments in a college, as faculty id -> batch ids. */
export function useFacultyAssignments(collegeId: string | null) {
  return useQuery({
    queryKey: assignmentsKey(collegeId ?? ""),
    enabled: collegeId !== null,
    queryFn: async (): Promise<Map<string, string[]>> => {
      const { data, error } = await supabase
        .from("faculty_batches")
        .select("faculty_id, batch_id")
        .eq("college_id", collegeId!)
        .is("unassigned_at", null);
      if (error) throw new Error(error.message);
      const byFaculty = new Map<string, string[]>();
      for (const a of data) byFaculty.set(a.faculty_id, [...(byFaculty.get(a.faculty_id) ?? []), a.batch_id]);
      return byFaculty;
    },
  });
}

/** Every faculty role, retired ones included (so an existing faculty member's role still shows its name). */
export function useFacultyRoles() {
  return useQuery({
    queryKey: ["faculty-roles"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<FacultyRole[]> => {
      const { data, error } = await supabase.from("faculty_roles").select("id, label, is_active").order("sort_order");
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

// Look-alikes (0/O, 1/l/I) left out so a password read off a screen is typed correctly. Mirrors the Edge Function.
const PASSWORD_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const GENERATED_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 72;

/** A random 12-character password (rejection sampling, so every character is equally likely). */
export function generatePassword(): string {
  const out: string[] = [];
  const limit = 256 - (256 % PASSWORD_CHARS.length);
  while (out.length < GENERATED_PASSWORD_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      if (byte < limit && out.length < GENERATED_PASSWORD_LENGTH) out.push(PASSWORD_CHARS[byte % PASSWORD_CHARS.length]);
    }
  }
  return out.join("");
}

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Password can be at most ${MAX_PASSWORD_LENGTH} characters`;
  return null;
}

export interface FacultyInput {
  full_name: string;
  email: string;
  phone: string;
  department_id: string | null;
  faculty_role_id: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(input: FacultyInput): FacultyInput {
  return { ...input, full_name: input.full_name.trim(), email: input.email.trim().toLowerCase(), phone: input.phone.trim() };
}

/** The first problem with one faculty member's details, or null. Same rules as the Edge Function. */
export function facultyProblem(input: FacultyInput): string | null {
  const f = clean(input);
  if (!f.full_name) return "Full name is required";
  if (!EMAIL_RE.test(f.email)) return "A valid email is required";
  return null;
}

function useInvalidateFaculty(collegeId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: facultyKey(collegeId) });
    void queryClient.invalidateQueries({ queryKey: assignmentsKey(collegeId) });
  };
}

/** Creates the account and returns the generated faculty ID. */
export function useAddFaculty(collegeId: string) {
  const invalidate = useInvalidateFaculty(collegeId);
  return useMutation({
    mutationFn: async ({ input, password }: { input: FacultyInput; password: string }): Promise<string> => {
      const problem = facultyProblem(input) ?? passwordProblem(password);
      if (problem) throw new Error(problem);
      const data = await callCollegeUsers({ action: "faculty_create", college_id: collegeId, ...clean(input), password });
      return (data as { code: string }).code;
    },
    onSuccess: invalidate,
  });
}

/** Replaces name, phone, department and role. Email and faculty ID never change. */
export function useUpdateFaculty(collegeId: string) {
  const invalidate = useInvalidateFaculty(collegeId);
  return useMutation({
    mutationFn: async ({ facultyId, input }: { facultyId: string; input: FacultyInput }) => {
      const problem = facultyProblem(input);
      if (problem) throw new Error(problem);
      const { full_name, phone, department_id, faculty_role_id } = clean(input);
      await callCollegeUsers({ action: "faculty_update", faculty_id: facultyId, full_name, phone, department_id, faculty_role_id });
    },
    onSuccess: invalidate,
  });
}

export function useResetFacultyPassword() {
  return useMutation({
    mutationFn: async ({ facultyId, password }: { facultyId: string; password: string }) => {
      const problem = passwordProblem(password);
      if (problem) throw new Error(problem);
      await callCollegeUsers({ action: "faculty_reset_password", faculty_id: facultyId, password });
    },
  });
}

export function useSetFacultyStatus(collegeId: string) {
  const invalidate = useInvalidateFaculty(collegeId);
  return useMutation({
    mutationFn: async ({ facultyId, status }: { facultyId: string; status: Faculty["status"] }) => {
      await callCollegeUsers({ action: "faculty_set_status", faculty_id: facultyId, status });
    },
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Batch assignments of one faculty member. Assigning several batches is all or nothing; unassigning keeps the row
// (stamped with when it ended), so the history below includes past assignments too.
// ---------------------------------------------------------------------------------------------------------------

export interface FacultyAssignment {
  id: string;
  batch_id: string;
  assigned_at: string;
  unassigned_at: string | null;
}

const historyKey = (facultyId: string) => ["faculty-batch-history", facultyId];

/** Every assignment of the faculty member, current and ended, newest first. */
export function useFacultyBatchHistory(facultyId: string) {
  return useQuery({
    queryKey: historyKey(facultyId),
    queryFn: async (): Promise<FacultyAssignment[]> => {
      const { data, error } = await supabase
        .from("faculty_batches")
        .select("id, batch_id, assigned_at, unassigned_at")
        .eq("faculty_id", facultyId)
        .order("assigned_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

function useInvalidateAssignments(collegeId: string, facultyId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: historyKey(facultyId) });
    void queryClient.invalidateQueries({ queryKey: assignmentsKey(collegeId) });
  };
}

export function useAssignBatches(collegeId: string, facultyId: string) {
  const invalidate = useInvalidateAssignments(collegeId, facultyId);
  return useMutation({
    mutationFn: async (batchIds: string[]): Promise<number> => {
      if (batchIds.length === 0) throw new Error("Pick at least one batch");
      const data = await callCollegeUsers({ action: "faculty_assign_batches", faculty_id: facultyId, batch_ids: batchIds });
      return (data as { assigned: number }).assigned;
    },
    onSuccess: invalidate,
  });
}

export function useUnassignBatch(collegeId: string, facultyId: string) {
  const invalidate = useInvalidateAssignments(collegeId, facultyId);
  return useMutation({
    mutationFn: async (batchId: string) => {
      await callCollegeUsers({ action: "faculty_unassign_batch", faculty_id: facultyId, batch_id: batchId });
    },
    onSuccess: invalidate,
  });
}
