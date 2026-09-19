import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";

export interface Category {
  id: string;
  name: string;
  description: string | null;
}

export interface CategoryInput {
  name: string;
  description: string;
}

const CATEGORIES_KEY = ["categories"] as const;
const UNIQUE_VIOLATION = "23505";

// PostgREST errors aren't `Error` instances; normalise so callers can show `.message`.
function toError(error: { code?: string; message: string }): Error {
  return new Error(error.code === UNIQUE_VIOLATION ? "A category with this name already exists" : error.message);
}

export function useCategories() {
  return useQuery({
    queryKey: CATEGORIES_KEY,
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase.from("categories").select("id, name, description").order("name");
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
    mutationFn: async ({ id, name, description }: CategoryInput & { id?: string }) => {
      const values = { name: name.trim(), description: description.trim() || null };
      const { error } = id
        ? await supabase.from("categories").update(values).eq("id", id)
        : await supabase.from("categories").insert({ ...values, created_by: user?.id });
      if (error) throw toError(error);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY }),
  });
}
