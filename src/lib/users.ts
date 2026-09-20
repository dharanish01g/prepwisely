import { useCallback, useEffect, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { emailSchema, newPasswordSchema, parseOrThrow } from "@/lib/validation";

export interface StaffUser {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  address: string | null;
  status: "active" | "inactive";
  roles: string[];
}

export interface NewStaffUser {
  full_name: string;
  email: string;
  password: string;
  role_id: string;
  phone?: string;
  address?: string;
}

export function useUsers() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, email, phone, address, status, user_roles(role_id)")
      .order("created_at");
    if (error) {
      setError(error.message);
    } else {
      setError(null);
      setUsers(
        (data ?? []).map(({ user_roles, ...p }) => ({
          ...p,
          status: p.status as StaffUser["status"],
          roles: user_roles.map((r) => r.role_id),
        })),
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { users, loading, error, refresh };
}

// Calls the superadmin-only `admin-users` Edge Function and surfaces its error message.
async function callAdminUsers(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("admin-users", { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null);
      throw new Error(payload?.error ?? "Request failed");
    }
    throw new Error(error.message);
  }
  return data;
}

export interface StaffUserDetails {
  full_name: string;
  phone?: string;
  address?: string;
}

const optionalText = z.string().trim().optional();

const staffUserDetailsSchema = z.object({
  full_name: z.string().trim().min(1, "Full name is required"),
  phone: optionalText,
  address: optionalText,
});

const newStaffUserSchema = staffUserDetailsSchema.extend({
  email: emailSchema,
  password: newPasswordSchema,
  role_id: z.string().min(1, "Select a role"),
});

// Each call validates first and throws an Error with the first problem, which the dialogs already display.
export const updateUser = (userId: string, details: StaffUserDetails) =>
  callAdminUsers({ action: "update", user_id: userId, ...parseOrThrow(staffUserDetailsSchema, details) });

export const resetPassword = (userId: string, password: string) =>
  callAdminUsers({ action: "reset_password", user_id: userId, password: parseOrThrow(newPasswordSchema, password) });

export const createUser = (user: NewStaffUser) =>
  callAdminUsers({ action: "create", ...parseOrThrow(newStaffUserSchema, user) });
