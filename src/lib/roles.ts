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

// Last known role ids, kept per user so the sidebar can still be drawn (disabled) when the app starts offline.
// UI-only: the database enforces real access with RLS, so a stale copy can't grant anything.
const ROLES_CACHE_PREFIX = "prepwisely.my-roles.";

function readCachedRoles(userId: string | undefined): string[] | undefined {
  if (!userId) return undefined;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ROLES_CACHE_PREFIX + userId) ?? "null");
    return Array.isArray(parsed) && parsed.every((r) => typeof r === "string") ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeCachedRoles(userId: string, roleIds: string[]) {
  try {
    localStorage.setItem(ROLES_CACHE_PREFIX + userId, JSON.stringify(roleIds));
  } catch {
    // Storage full or blocked; the sidebar just won't survive an offline start.
  }
}

/** Forget every cached role list. Call on sign-out so the next person on this machine doesn't see them. */
export function clearCachedRoles() {
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(ROLES_CACHE_PREFIX));
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Storage blocked; nothing was cached.
  }
}

/** Role ids of the signed-in user (RLS lets each user read their own roles). */
export function useMyRoleIds() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-roles", user?.id],
    enabled: !!user,
    // Start from the last known roles, but treat them as stale (updatedAt 0) so they are refetched right away.
    // If that refetch fails, the query errors but keeps this data.
    initialData: () => readCachedRoles(user?.id),
    initialDataUpdatedAt: 0,
    queryFn: async (): Promise<string[]> => {
      // Staff roles plus 'student' for a student account (students have no staff profile or user_roles rows).
      const { data, error } = await supabase.rpc("my_role_ids");
      if (error) throw error;
      const roleIds = (data ?? []) as string[];
      writeCachedRoles(user!.id, roleIds);
      return roleIds;
    },
  });
}

/** UI-only convenience; the database enforces the real rule with RLS. */
export function useIsSuperadmin() {
  const { data, isPending } = useMyRoleIds();
  return { isSuperadmin: data?.includes("superadmin") ?? false, loading: isPending };
}
