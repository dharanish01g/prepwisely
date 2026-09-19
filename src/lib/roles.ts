import { useEffect, useState } from "react";
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
