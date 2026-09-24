import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { parseOrThrow } from "@/lib/validation";

const UNIQUE_VIOLATION = "23505";

// PostgREST errors aren't `Error` instances; normalise so callers can show `.message`, and turn the
// uniqueness rules from the database into sentences.
function toError(error: { code?: string; message: string }): Error {
  if (error.code === UNIQUE_VIOLATION) {
    if (error.message.includes("colleges_code_key")) return new Error("This college code is already taken");
    if (error.message.includes("colleges_name_city_key")) return new Error("A college with this name already exists in this city");
  }
  return new Error(error.message);
}

export const CONTACT_PREFIXES = ["Mr.", "Mrs.", "Ms.", "Dr.", "Prof."] as const;
export type ContactPrefix = (typeof CONTACT_PREFIXES)[number];

export interface College {
  id: string;
  name: string;
  /** Short unique code (e.g. SEC), set once at creation and never changed; batch codes start with it. */
  code: string;
  status: "active" | "suspended";
  contact_prefix: ContactPrefix | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_phone_alt: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  /** Optional free text for anything else worth knowing about the college. */
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const COLLEGES_KEY = ["colleges"];

/** The colleges the signed-in user may see: all for superadmin/support, only assigned ones for a manager. */
export function useColleges() {
  return useQuery({
    queryKey: COLLEGES_KEY,
    queryFn: async (): Promise<College[]> => {
      const { data, error } = await supabase
        .from("colleges")
        .select(
          "id, name, code, status, contact_prefix, contact_name, contact_email, contact_phone, contact_phone_alt, city, state, address, notes, created_at, updated_at",
        )
        .order("created_at", { ascending: false });
      if (error) throw toError(error);
      return data;
    },
  });
}

const requiredText = (label: string) => z.string().trim().min(1, `${label} is required`);

const requiredEmail = z
  .string()
  .trim()
  .min(1, "Contact email is required")
  .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), { message: "Enter a valid email address" });

const requiredPrefix = z
  .string()
  .trim()
  .min(1, "Prefix is required")
  .refine((v): v is ContactPrefix => (CONTACT_PREFIXES as readonly string[]).includes(v), { message: "Unknown prefix" });

const collegeInputSchema = z.object({
  name: requiredText("College name"),
  contact_prefix: requiredPrefix,
  contact_name: requiredText("Contact name"),
  contact_email: requiredEmail,
  contact_phone: requiredText("Contact phone"),
  contact_phone_alt: requiredText("Alternate phone"),
  city: requiredText("City"),
  state: requiredText("State"),
  address: requiredText("Address"),
  // The only optional field. Blank is stored as null.
  notes: z
    .string()
    .trim()
    .max(2000, "Notes can be at most 2000 characters")
    .transform((v) => v || null),
});

// Same rule as the database's check: 2-10 capital letters or digits. Input is uppercased first.
const collegeCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, "College code is required")
  .regex(/^[A-Z0-9]{2,10}$/, "College code must be 2-10 letters or digits");

export interface CollegeFormInput {
  name: string;
  /** Only used when creating; the code can't be changed afterwards, so edits ignore it. */
  code?: string;
  contact_prefix: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  contact_phone_alt: string;
  city: string;
  state: string;
  address: string;
  notes: string;
}

/**
 * Creates a college (via `onboarding_create_college`, which also self-assigns the calling manager),
 * or updates contact details when `id` is given. `status` (suspend/reactivate) is superadmin-only and
 * isn't touched here.
 */
export function useSaveCollege() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id?: string; input: CollegeFormInput }) => {
      const values = parseOrThrow(collegeInputSchema, input);
      if (id) {
        // `values` never includes code: it has no update grant, so sending it would be refused.
        const { data, error } = await supabase
          .from("colleges")
          .update(values)
          .eq("id", id)
          .select("id");
        if (error) throw toError(error);
        if (!data.length) throw new Error("This college can't be edited");
      } else {
        const code = parseOrThrow(collegeCodeSchema, input.code ?? "");
        const { error } = await supabase.rpc("onboarding_create_college", {
          p_name: values.name,
          p_code: code,
          p_contact_name: values.contact_name,
          p_contact_email: values.contact_email,
          p_contact_phone: values.contact_phone,
          p_contact_prefix: values.contact_prefix,
          p_contact_phone_alt: values.contact_phone_alt,
          p_city: values.city,
          p_state: values.state,
          p_address: values.address,
          p_notes: values.notes,
        });
        if (error) throw toError(error);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: COLLEGES_KEY }),
  });
}

/** Suspend/reactivate. Superadmin-only, enforced server-side by `superadmin_set_college_status`. */
export function useSetCollegeStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "active" | "suspended" }) => {
      const { error } = await supabase.rpc("superadmin_set_college_status", { p_college_id: id, p_status: status });
      if (error) throw toError(error);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: COLLEGES_KEY }),
  });
}
