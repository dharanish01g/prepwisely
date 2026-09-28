import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { callCollegeUsers } from "@/lib/students";
import { passwordProblem } from "@/lib/faculty";

// TPOs of a college (any number). Accounts are created, edited, reset and (de)activated only through the
// `college-users` Edge Function (superadmin, or the college's assigned onboarding manager); the table is read-only to
// the app. Each TPO gets a locked TPO ID (college code + T + 3 characters, e.g. SEC-T7K2). A TPO is either a new login
// (email + a password the manager hands them) or an existing faculty member of the same college, who keeps their
// faculty login and gets both roles. Designation is optional and picked from the TPO designation list.

export interface Tpo {
  id: string;
  college_id: string;
  code: string;
  full_name: string;
  email: string;
  phone: string | null;
  designation_id: string | null;
  status: "active" | "inactive";
  created_at: string;
}

export interface TpoDesignation {
  id: string;
  label: string;
  is_active: boolean;
}

const TPO_COLUMNS = "id, college_id, code, full_name, email, phone, designation_id, status, created_at";
const tpoKey = (collegeId: string) => ["tpo", collegeId];

export function useCollegeTpos(collegeId: string | null) {
  return useQuery({
    queryKey: tpoKey(collegeId ?? ""),
    enabled: collegeId !== null,
    queryFn: async (): Promise<Tpo[]> => {
      const { data, error } = await supabase.from("tpo").select(TPO_COLUMNS).eq("college_id", collegeId!).order("full_name");
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

/** Every designation, retired ones included (so an existing TPO's designation still shows its name). */
export function useTpoDesignations() {
  return useQuery({
    queryKey: ["tpo-designations"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<TpoDesignation[]> => {
      const { data, error } = await supabase.from("tpo_designations").select("id, label, is_active").order("sort_order");
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

export interface TpoInput {
  full_name: string;
  email: string;
  phone: string;
  designation_id: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(input: TpoInput): TpoInput {
  return { ...input, full_name: input.full_name.trim(), email: input.email.trim().toLowerCase(), phone: input.phone.trim() };
}

/** The first problem with a TPO's details, or null. Same rules as the Edge Function. */
export function tpoProblem(input: TpoInput): string | null {
  const t = clean(input);
  if (!t.full_name) return "Full name is required";
  if (!EMAIL_RE.test(t.email)) return "A valid email is required";
  return null;
}

// A faculty member who is also a TPO shares name and phone across both rows, and their status decides sign-in for
// both, so TPO changes refresh the college's faculty list too.
function useInvalidateTpos(collegeId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: tpoKey(collegeId) });
    void queryClient.invalidateQueries({ queryKey: ["faculty", collegeId] });
  };
}

/** Creates a new login and returns the generated TPO ID. */
export function useAddTpo(collegeId: string) {
  const invalidate = useInvalidateTpos(collegeId);
  return useMutation({
    mutationFn: async ({ input, password }: { input: TpoInput; password: string }): Promise<string> => {
      const problem = tpoProblem(input) ?? passwordProblem(password);
      if (problem) throw new Error(problem);
      const data = await callCollegeUsers({ action: "tpo_create", college_id: collegeId, ...clean(input), password });
      return (data as { code: string }).code;
    },
    onSuccess: invalidate,
  });
}

/** Makes an existing faculty member a TPO on their own login and returns the generated TPO ID. */
export function useAddTpoFromFaculty(collegeId: string) {
  const invalidate = useInvalidateTpos(collegeId);
  return useMutation({
    mutationFn: async ({ facultyId, designationId }: { facultyId: string; designationId: string | null }): Promise<string> => {
      const data = await callCollegeUsers({ action: "tpo_create_from_faculty", faculty_id: facultyId, designation_id: designationId });
      return (data as { code: string }).code;
    },
    onSuccess: invalidate,
  });
}

/** Replaces name, phone and designation. Email and TPO ID never change. */
export function useUpdateTpo(collegeId: string) {
  const invalidate = useInvalidateTpos(collegeId);
  return useMutation({
    mutationFn: async ({ tpoId, input }: { tpoId: string; input: TpoInput }) => {
      const problem = tpoProblem(input);
      if (problem) throw new Error(problem);
      const { full_name, phone, designation_id } = clean(input);
      await callCollegeUsers({ action: "tpo_update", tpo_id: tpoId, full_name, phone, designation_id });
    },
    onSuccess: invalidate,
  });
}

export function useResetTpoPassword() {
  return useMutation({
    mutationFn: async ({ tpoId, password }: { tpoId: string; password: string }) => {
      const problem = passwordProblem(password);
      if (problem) throw new Error(problem);
      await callCollegeUsers({ action: "tpo_reset_password", tpo_id: tpoId, password });
    },
  });
}

export function useSetTpoStatus(collegeId: string) {
  const invalidate = useInvalidateTpos(collegeId);
  return useMutation({
    mutationFn: async ({ tpoId, status }: { tpoId: string; status: Tpo["status"] }) => {
      await callCollegeUsers({ action: "tpo_set_status", tpo_id: tpoId, status });
    },
    onSuccess: invalidate,
  });
}
