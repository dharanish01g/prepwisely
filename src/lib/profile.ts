import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { newPasswordSchema, parseOrThrow } from "@/lib/validation";

export interface MyProfile {
  full_name: string;
  email: string;
  phone: string | null;
  address: string | null;
  status: "active" | "inactive";
  created_at: string;
  /** Set for a student account: where they study. Staff have an address instead. */
  student?: {
    roll_number: string;
    batch_code: string;
    graduation_year: number;
    department: string;
    college: string;
  };
  /** Set for a faculty and/or TPO account (one login can be both): their college and each role's details. */
  collegeStaff?: {
    college: string;
    faculty?: { code: string; department: string | null; role: string | null };
    tpo?: { code: string; designation: string | null };
  };
}

/**
 * The signed-in user's own details: a staff profile row (RLS lets each user read it), or for a student, their
 * students row with batch, department and college (via my_student_profile(), since students can't read those tables),
 * or for faculty/TPO their row(s) with college and role details (my_faculty_profile() / my_tpo_profile()).
 */
export function useMyProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-profile", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<MyProfile> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, email, phone, address, status, created_at")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      if (data) return { ...data, status: data.status as MyProfile["status"] };

      const [studentRes, facultyRes, tpoRes] = await Promise.all([
        supabase.rpc("my_student_profile"),
        supabase.rpc("my_faculty_profile"),
        supabase.rpc("my_tpo_profile"),
      ]);
      const failed = studentRes.error ?? facultyRes.error ?? tpoRes.error;
      if (failed) throw failed;
      const s = studentRes.data?.[0];
      const f = facultyRes.data?.[0];
      const t = tpoRes.data?.[0];

      // Faculty and/or TPO: a faculty+TPO login has both rows, with the same name, email, phone and college.
      if (!s && (f || t)) {
        const base = (f ?? t)!;
        return {
          full_name: base.full_name,
          email: base.email,
          phone: base.phone,
          address: null,
          status: (f?.status === "active" || t?.status === "active" ? "active" : "inactive") as MyProfile["status"],
          created_at: base.created_at,
          collegeStaff: {
            college: `${base.college_code} · ${base.college_name}`,
            faculty: f && {
              code: f.code,
              department: f.department_code ? `${f.department_code} · ${f.department_name}` : null,
              role: f.faculty_role,
            },
            tpo: t && { code: t.code, designation: t.designation },
          },
        };
      }

      if (!s) throw new Error("No profile found for this account");
      return {
        full_name: s.full_name,
        email: s.email,
        phone: s.phone,
        address: null,
        status: s.status as MyProfile["status"],
        created_at: s.created_at,
        student: {
          roll_number: s.roll_number,
          batch_code: s.batch_code,
          graduation_year: s.graduation_year,
          department: `${s.department_code} · ${s.department_name}`,
          college: `${s.college_code} · ${s.college_name}`,
        },
      };
    },
  });
}

/** Changes the signed-in user's own password. Throws an Error with a displayable message. */
export async function changeMyPassword(password: string, confirm: string) {
  const valid = parseOrThrow(newPasswordSchema, password);
  if (valid !== confirm) throw new Error("Passwords don't match");
  const { error } = await supabase.auth.updateUser({ password: valid });
  if (error) {
    if (/different from the old password|same_password/i.test(error.message)) {
      throw new Error("New password must be different from your current one");
    }
    if (/fetch|network|failed to/i.test(error.message)) {
      throw new Error("Couldn't reach the server. Check your internet connection.");
    }
    throw new Error(error.message);
  }
}
