import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";

// Roles live in the `roles` table (public.roles). Nothing is hardcoded here.
// Later: add role_permissions and expose `can(role, permission)` from this module.
export interface Role {
  id: string;
  label: string;
  description: string;
}

export function useRoles() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("roles")
      .select("id, label, description")
      .order("sort_order")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error("Failed to load roles", error);
        else setRoles(data ?? []);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const roleLabel = (id: string) => roles.find((r) => r.id === id)?.label ?? id;

  return { roles, loading, roleLabel };
}

/** Role ids of the signed-in user (RLS lets each user read their own roles). */
export function useMyRoleIds() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-roles", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase.from("user_roles").select("role_id").eq("user_id", user!.id);
      if (error) throw error;
      return data.map((r) => r.role_id);
    },
  });
}

/** UI-only convenience; the database enforces the real rule with RLS. */
export function useIsSuperadmin() {
  const { data, isPending } = useMyRoleIds();
  return { isSuperadmin: data?.includes("superadmin") ?? false, loading: isPending };
}
