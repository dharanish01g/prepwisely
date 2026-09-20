import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { parseOrThrow } from "@/lib/validation";
import { useAuth } from "@/hooks/use-auth";

export interface Category {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  description: string | null;
  is_active: boolean;
}

export interface CategoryInput {
  name: string;
  slug: string;
  parent_id: string | null;
  description: string;
  is_active: boolean;
}

const categorySchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  slug: z
    .string()
    .trim()
    .min(1, "Slug is required")
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug can only contain lowercase letters, numbers and hyphens"),
  parent_id: z.string().nullable(),
  description: z.string().trim(),
  is_active: z.boolean(),
});

const CATEGORIES_KEY = ["categories"] as const;
const UNIQUE_VIOLATION = "23505";

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// PostgREST errors aren't `Error` instances; normalise so callers can show `.message`.
function toError(error: { code?: string; message: string }): Error {
  if (error.code === UNIQUE_VIOLATION) {
    return new Error(
      error.message.includes("categories_slug_key")
        ? "This slug is already used by another category"
        : "A category with this name already exists under the selected parent",
    );
  }
  if (/categories_slug_format/.test(error.message)) {
    return new Error("Slug can only contain lowercase letters, numbers and hyphens");
  }
  return new Error(error.message);
}

export function useCategories() {
  return useQuery({
    queryKey: CATEGORIES_KEY,
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase
        .from("categories")
        .select("id, name, slug, parent_id, description, is_active")
        .order("name");
      if (error) throw toError(error);
      return data;
    },
  });
}

/** Creates a category, or updates it when `id` is given. */
export function useSaveCategory() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ id, ...input }: CategoryInput & { id?: string }) => {
      const { description, ...rest } = parseOrThrow(categorySchema, input);
      const values = { ...rest, description: description || null };
      const { error } = id
        ? await supabase.from("categories").update(values).eq("id", id)
        : await supabase.from("categories").insert({ ...values, created_by: user?.id });
      if (error) throw toError(error);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY }),
  });
}

export interface CategoryRow {
  category: Category;
  depth: number;
  /** Ancestor names plus its own, e.g. "Aptitude › Algebra". */
  path: string;
}

/** Flattens the tree depth-first (each parent followed by its children), with depth and path. */
export function buildCategoryRows(categories: Category[]): CategoryRow[] {
  const childrenOf = new Map<string | null, Category[]>();
  for (const c of categories) {
    const siblings = childrenOf.get(c.parent_id) ?? [];
    siblings.push(c);
    childrenOf.set(c.parent_id, siblings);
  }

  const rows: CategoryRow[] = [];
  const walk = (parentId: string | null, depth: number, parentPath: string) => {
    for (const category of childrenOf.get(parentId) ?? []) {
      const path = parentPath ? `${parentPath} › ${category.name}` : category.name;
      rows.push({ category, depth, path });
      walk(category.id, depth + 1, path);
    }
  };
  walk(null, 0, "");
  return rows;
}

/** The category's own id plus every descendant id; none of these may become its parent. */
export function selfAndDescendantIds(categories: Category[], id: string): Set<string> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of categories) {
      if (c.parent_id && ids.has(c.parent_id) && !ids.has(c.id)) {
        ids.add(c.id);
        grew = true;
      }
    }
  }
  return ids;
}
