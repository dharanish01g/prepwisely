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
}

/** The signed-in user's own profile row (RLS lets each user read it). */
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
        .single();
      if (error) throw error;
      return { ...data, status: data.status as MyProfile["status"] };
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
