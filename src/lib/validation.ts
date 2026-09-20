import { z } from "zod";

/** Matches the minimum enforced by the admin-users Edge Function. */
export const MIN_PASSWORD_LENGTH = 8;

export const emailSchema = z.string().trim().min(1, "Email is required").pipe(z.email("Enter a valid email address"));

export const newPasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);

/** The first problem with the value, or null when it passes. Issues come out in field order. */
export function firstIssue(schema: z.ZodType, value: unknown): string | null {
  const result = schema.safeParse(value);
  return result.success ? null : result.error.issues[0].message;
}

/** Parses and returns the cleaned value (trimmed etc.), or throws an Error whose message is the first issue. */
export function parseOrThrow<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(result.error.issues[0].message);
  return result.data;
}
