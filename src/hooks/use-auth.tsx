import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { emailSchema, firstIssue } from "@/lib/validation";

interface AuthContextValue {
  user: User | null;
  /** True until the persisted session (if any) has been read. */
  loading: boolean;
  /** Resolves to an error message, or null on success. */
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Only shape is checked here; length rules apply when a password is set, not when signing in to an existing account.
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, "Password is required") });

function friendlyError(message: string): string {
  if (/invalid login credentials/i.test(message)) return "Incorrect email or password.";
  if (/email not confirmed/i.test(message)) return "This account hasn't been activated yet.";
  if (/fetch|network|failed to/i.test(message)) return "Couldn't reach the server. Check your internet connection.";
  return "Couldn't sign in. Please try again.";
}

/**
 * prepwisely is for staff only: students use PrepCode, which shares this Supabase project, so their passwords work
 * here too. A user counts as staff if `my_role_ids()` returns any role other than 'student' (a user_roles row).
 */
export function hasStaffRole(roleIds: readonly string[]): boolean {
  return roleIds.some((id) => id !== "student");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // True while signIn checks a new session's roles; the session isn't shown to the app until it passes.
  const vetting = useRef(false);

  useEffect(() => {
    let active = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) setSession(data.session);
      })
      .catch(console.error)
      .finally(() => {
        if (active) setLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!vetting.current) setSession(next);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      loading,
      async signIn(email, password) {
        const problem = firstIssue(loginSchema, { email, password });
        if (problem) return problem;
        vetting.current = true;
        try {
          const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
          if (error) return friendlyError(error.message);
          const { data: roleIds, error: rolesError } = await supabase.rpc("my_role_ids");
          if (rolesError || !hasStaffRole((roleIds ?? []) as string[])) {
            await supabase.auth.signOut();
            // Not staff: answer exactly as for a wrong password, so prepwisely says nothing about the account.
            return friendlyError(rolesError ? rolesError.message : "Invalid login credentials");
          }
          setSession(data.session);
          return null;
        } catch (err) {
          console.error("[auth] sign-in failed:", err);
          await supabase.auth.signOut().catch(() => {});
          return friendlyError(err instanceof Error ? err.message : "");
        } finally {
          vetting.current = false;
        }
      },
      async signOut() {
        await supabase.auth.signOut();
      },
    }),
    [session, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
