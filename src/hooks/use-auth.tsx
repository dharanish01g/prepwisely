import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

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
      setSession(next);
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
        try {
          const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
          return error ? friendlyError(error.message) : null;
        } catch (err) {
          console.error("[auth] sign-in failed:", err);
          return friendlyError(err instanceof Error ? err.message : "");
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
