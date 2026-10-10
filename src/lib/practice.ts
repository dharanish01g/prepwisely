import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { parseOrThrow } from "@/lib/validation";

// PrepCode Practice (PRACTICE.md §4): domains (the headings on PrepCode's Practice screen) holding categories (the
// cards). Superadmin and content managers manage them; writes go through the `pc_*` database functions. A card shows
// either a Lucide icon (by name) or an image uploaded to the `pc-images` bucket. Nothing is deleted: domains and
// categories are archived, which hides them from PrepCode.

export interface PcDomain {
  id: string;
  slug: string;
  title: string;
  position: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface PcCategory {
  id: string;
  domain_id: string;
  slug: string;
  title: string;
  description: string;
  /** A Lucide icon name (e.g. "calculator"); null when the card uses an image. */
  icon: string | null;
  /** The card's uploaded image (https); null when it uses an icon. */
  logo_url: string | null;
  /** Markdown shown above the questions. */
  details: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface PracticeData {
  /** Every domain, archived included, in display order. */
  domains: PcDomain[];
  /** Every category, archived included, in display order within its domain. */
  categories: PcCategory[];
}

const PRACTICE_KEY = ["practice"] as const;
const IMAGE_BUCKET = "pc-images";
/** The bucket's limit (200 KB). */
export const MAX_IMAGE_BYTES = 200 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

export function usePractice() {
  return useQuery({
    queryKey: PRACTICE_KEY,
    queryFn: async (): Promise<PracticeData> => {
      const [domains, categories] = await Promise.all([
        supabase.from("pc_domains").select("id, slug, title, position, created_at, updated_at, archived_at").order("position"),
        supabase
          .from("pc_categories")
          .select("id, domain_id, slug, title, description, icon, logo_url, details, position, created_at, updated_at, archived_at")
          .order("position"),
      ]);
      if (domains.error) throw new Error(domains.error.message);
      if (categories.error) throw new Error(categories.error.message);
      return { domains: domains.data as PcDomain[], categories: categories.data as PcCategory[] };
    },
  });
}

/** A slug suggestion from a title: "Programming Basics" → "programming-basics". */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
}

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Slug is required")
  .max(64, "Slug can be at most 64 characters")
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug can only use lowercase letters, digits and single hyphens (for example programming-basics)");

const titleSchema = z.string().trim().min(1, "Title is required").max(60, "Title can be at most 60 characters");

const domainSchema = z.object({ slug: slugSchema, title: titleSchema });

const categorySchema = z
  .object({
    domain_id: z.string().min(1, "Choose a domain"),
    slug: slugSchema,
    title: titleSchema,
    description: z.string().trim().min(1, "Description is required").max(200, "Description can be at most 200 characters"),
    icon: z.string().nullable(),
    logo_url: z.string().nullable(),
    details: z.string().trim().max(20000, "Details can be at most 20,000 characters"),
  })
  .refine((c) => !(c.icon && c.logo_url), "Choose an icon or an image, not both");

export interface DomainInput {
  slug: string;
  title: string;
}

export interface CategoryInput {
  domain_id: string;
  slug: string;
  title: string;
  description: string;
  icon: string | null;
  logo_url: string | null;
  details: string;
}

function useInvalidatePractice() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: PRACTICE_KEY });
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

export function useCreateDomain() {
  const invalidate = useInvalidatePractice();
  return useMutation({
    mutationFn: async (input: DomainInput) => {
      const d = parseOrThrow(domainSchema, input);
      return (await rpc("pc_domain_create", { p_slug: d.slug, p_title: d.title })) as string;
    },
    onSuccess: invalidate,
  });
}

/** Renames a domain; its slug never changes. */
export function useUpdateDomain() {
  const invalidate = useInvalidatePractice();
  return useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const t = parseOrThrow(titleSchema, title);
      await rpc("pc_domain_update", { p_domain_id: id, p_title: t });
    },
    onSuccess: invalidate,
  });
}

export function useSetDomainArchived() {
  const invalidate = useInvalidatePractice();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      rpc("pc_domain_set_archived", { p_domain_id: id, p_archived: archived }),
    onSuccess: invalidate,
  });
}

/** Every domain's id (archived included) in the new order. */
export function useReorderDomains() {
  const invalidate = useInvalidatePractice();
  return useMutation({
    mutationFn: (ids: string[]) => rpc("pc_domains_reorder", { p_domain_ids: ids }),
    onSettled: invalidate,
  });
}

function categoryArgs(input: CategoryInput) {
  const c = parseOrThrow(categorySchema, input);
  return {
    p_domain_id: c.domain_id,
    p_title: c.title,
    p_description: c.description,
    p_icon: c.icon,
    p_logo_url: c.logo_url,
    p_details: c.details || null,
    slug: c.slug,
  };
}

export function useCreateCategory() {
  const invalidate = useInvalidatePractice();
  return useMutation({
    mutationFn: async (input: CategoryInput) => {
      const { slug, ...args } = categoryArgs(input);
      return (await rpc("pc_category_create", { ...args, p_slug: slug })) as string;
    },
    onSuccess: invalidate,
  });
}

/** Replaces every field but the slug. Moving to another domain puts the category last there. */
export function useUpdateCategory() {
  const invalidate = useInvalidatePractice();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: CategoryInput }) => {
      const { slug: _slug, ...args } = categoryArgs(input);
      await rpc("pc_category_update", { p_category_id: id, ...args });
    },
    onSuccess: invalidate,
  });
}

export function useSetCategoryArchived() {
  const invalidate = useInvalidatePractice();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      rpc("pc_category_set_archived", { p_category_id: id, p_archived: archived }),
    onSuccess: invalidate,
  });
}

/** Every category id of the domain (archived included) in the new order. */
export function useReorderCategories() {
  const invalidate = useInvalidatePractice();
  return useMutation({
    mutationFn: ({ domainId, ids }: { domainId: string; ids: string[] }) =>
      rpc("pc_categories_reorder", { p_domain_id: domainId, p_category_ids: ids }),
    onSettled: invalidate,
  });
}

/** Uploads a card image under a new name and returns its public address. Images are never overwritten. */
export async function uploadCategoryImage(file: File): Promise<string> {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error("Use a PNG, JPG or WebP image");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("The image must be 200 KB or smaller");
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `categories/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);
  return supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}
