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
}

/**
 * The signed-in user's own details: a staff profile row (RLS lets each user read it), or for a student, their
 * students row with batch, department and college (via my_student_profile(), since students can't read those tables).
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

      const { data: rows, error: studentError } = await supabase.rpc("my_student_profile");
      if (studentError) throw studentError;
      const s = rows?.[0];
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
