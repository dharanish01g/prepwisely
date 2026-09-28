import { useEffect, useState, useSyncExternalStore } from "react";
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

// The role a user with several roles (e.g. faculty + TPO on one login) is working as, kept per user so the app
// reopens in the same role. UI-only: it picks which sidebar to show; RLS still grants every role the user holds.
const ACTIVE_ROLE_PREFIX = "prepwisely.active-role.";
const activeRoleListeners = new Set<() => void>();
// This session's choices, so switching still works when storage is blocked.
const chosenRoles = new Map<string, string>();

function readActiveRole(userId: string | undefined): string | null {
  if (!userId) return null;
  const chosen = chosenRoles.get(userId);
  if (chosen) return chosen;
  try {
    return localStorage.getItem(ACTIVE_ROLE_PREFIX + userId);
  } catch {
    return null;
  }
}

/** The user's saved role choice (null if none). Shared by every component that reads it. */
export function useSavedActiveRole(): string | null {
  const { user } = useAuth();
  return useSyncExternalStore(
    (onChange) => {
      activeRoleListeners.add(onChange);
      return () => activeRoleListeners.delete(onChange);
    },
    () => readActiveRole(user?.id),
  );
}

export function saveActiveRole(userId: string, roleId: string) {
  chosenRoles.set(userId, roleId);
  try {
    localStorage.setItem(ACTIVE_ROLE_PREFIX + userId, roleId);
  } catch {
    // Storage blocked; the choice lasts until the app closes.
  }
  activeRoleListeners.forEach((notify) => notify());
}

/** UI-only convenience; the database enforces the real rule with RLS. */
export function useIsSuperadmin() {
  const { data, isPending } = useMyRoleIds();
  return { isSuperadmin: data?.includes("superadmin") ?? false, loading: isPending };
}
