import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface QualityGuidelines {
  content: string;
  updated_at: string;
}

const KEY = ["quality-guidelines"];

/** The single quality-bar document. Readable by the content team; see quality_guidelines RLS for who can edit. */
export function useQualityGuidelines() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<QualityGuidelines> => {
      const { data, error } = await supabase.from("quality_guidelines").select("content, updated_at").eq("id", 1).single();
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

export function useSaveQualityGuidelines() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (content: string) => {
      const { error } = await supabase.from("quality_guidelines").update({ content }).eq("id", 1);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}
