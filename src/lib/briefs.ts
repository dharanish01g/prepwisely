import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { type BriefDifficulty, briefSchema, emptyProgress, type ProgressByDifficulty } from "@/lib/brief-logic";
import { QUESTIONS_KEY } from "@/lib/questions";
import { supabase } from "@/lib/supabase";
import { parseOrThrow } from "@/lib/validation";

// Under the questions key on purpose: anything that changes questions (submit, review, archive, refresh)
// also refreshes brief progress.
const BRIEFS_KEY = [...QUESTIONS_KEY, "briefs"] as const;

const toError = (error: { message: string }) => new Error(error.message);

export interface Brief {
  id: string;
  title: string;
  description: string;
  category_id: string;
  target_easy: number;
  target_medium: number;
  target_hard: number;
  deadline: string | null;
  status: "open" | "closed";
  created_at: string;
  closed_at: string | null;
}

export interface BriefRow extends Brief {
  /** Assigned creators (a creator only ever sees their own assignment). */
  creator_ids: string[];
  /** Shared across everyone assigned: approved, non-archived questions and those in review. */
  progress: ProgressByDifficulty;
}

/** The briefs the signed-in user may see: all of them for a manager, only assigned ones for a creator. */
export function useBriefs() {
  return useQuery({
    queryKey: BRIEFS_KEY,
    queryFn: async (): Promise<BriefRow[]> => {
      const [briefs, assignments, progress] = await Promise.all([
        supabase
          .from("briefs")
          .select("id, title, description, category_id, target_easy, target_medium, target_hard, deadline, status, created_at, closed_at")
          .order("created_at", { ascending: false }),
        supabase.from("brief_assignments").select("brief_id, creator_id"),
        supabase.rpc("brief_progress"),
      ]);
      if (briefs.error) throw toError(briefs.error);
      if (assignments.error) throw toError(assignments.error);
      if (progress.error) throw toError(progress.error);

      const creators = new Map<string, string[]>();
      for (const a of assignments.data) creators.set(a.brief_id, [...(creators.get(a.brief_id) ?? []), a.creator_id]);
      const counts = new Map<string, ProgressByDifficulty>();
      for (const p of progress.data as { brief_id: string; difficulty: BriefDifficulty; approved: number; in_review: number }[]) {
        const entry = counts.get(p.brief_id) ?? emptyProgress();
        entry[p.difficulty] = { approved: p.approved, in_review: p.in_review };
        counts.set(p.brief_id, entry);
      }
      return (briefs.data as Brief[]).map((b) => ({ ...b, creator_ids: creators.get(b.id) ?? [], progress: counts.get(b.id) ?? emptyProgress() }));
    },
  });
}

export interface Contribution {
  creator_id: string;
  approved: number;
  in_review: number;
}

/** Each creator's share of one brief (managers only). */
export function useBriefContributions(briefId: string) {
  return useQuery({
    queryKey: [...BRIEFS_KEY, "contributions", briefId],
    queryFn: async (): Promise<Contribution[]> => {
      const { data, error } = await supabase.rpc("brief_contributions", { p_brief_id: briefId });
      if (error) throw toError(error);
      return data as Contribution[];
    },
  });
}

export interface TeamMember {
  id: string;
  full_name: string;
  email: string;
  status: "active" | "inactive";
  roles: string[];
}

/** The content team (creators, reviewers, managers): names for the assignment picker and contribution tables. */
export function useContentTeam() {
  return useQuery({
    queryKey: ["content-team"],
    queryFn: async (): Promise<TeamMember[]> => {
      const { data, error } = await supabase.from("profiles").select("id, full_name, email, status, user_roles(role_id)").order("full_name");
      if (error) throw toError(error);
      return data.map(({ user_roles, ...p }) => ({
        ...p,
        status: p.status as TeamMember["status"],
        roles: (user_roles as { role_id: string }[]).map((r) => r.role_id),
      }));
    },
  });
}

export interface BriefFormInput {
  title: string;
  description: string;
  category_id: string | null;
  target_easy: number;
  target_medium: number;
  target_hard: number;
  /** "" for none, otherwise yyyy-mm-dd. */
  deadline: string;
  creator_ids: string[];
}

/** Creates a brief, or updates it when `id` is given, then brings its assignments in line with `creator_ids`. */
export function useSaveBrief() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ id, input, currentCreatorIds }: { id?: string; input: BriefFormInput; currentCreatorIds: string[] }) => {
      const { creator_ids, deadline, ...rest } = parseOrThrow(briefSchema, input);
      const values = { ...rest, deadline: deadline || null };

      let briefId = id;
      if (briefId) {
        // RLS filters rows silently, so an empty result means it isn't ours to edit.
        const { data, error } = await supabase.from("briefs").update(values).eq("id", briefId).select("id");
        if (error) throw toError(error);
        if (!data.length) throw new Error("This brief can't be edited");
      } else {
        const { data, error } = await supabase.from("briefs").insert({ ...values, created_by: user!.id }).select("id").single();
        if (error) throw toError(error);
        briefId = data.id as string;
      }

      const added = creator_ids.filter((c) => !currentCreatorIds.includes(c));
      const removed = currentCreatorIds.filter((c) => !creator_ids.includes(c));
      if (added.length) {
        const { error } = await supabase.from("brief_assignments").insert(added.map((creator_id) => ({ brief_id: briefId, creator_id, assigned_by: user!.id })));
        if (error) throw toError(error);
      }
      if (removed.length) {
        const { error } = await supabase.from("brief_assignments").delete().eq("brief_id", briefId).in("creator_id", removed);
        if (error) throw toError(error);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUESTIONS_KEY }),
  });
}

export function useSetBriefStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "open" | "closed" }) => {
      const { data, error } = await supabase.from("briefs").update({ status }).eq("id", id).select("id");
      if (error) throw toError(error);
      if (!data.length) throw new Error("This brief can't be changed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUESTIONS_KEY }),
  });
}
