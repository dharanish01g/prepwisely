import { FunctionsHttpError } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { type Access, type Check, type Difficulty, newId, type QuestionStatus } from "@/lib/practice-questions";

// PrepCode Practice MCQs (practice-mcq.md; PrepCode's "MCQ data structure for backend"): the editor's model and checks,
// and loading and saving them (pc_questions rows in MCQ cards with pc_question_options; migrations 20261018015742 and
// 20261018023456). Writes go through pc_mcq_save, which repeats every check below. Everything is markdown.
//
// Option ids are made here when an option is added and kept across saves, because PrepCode records picks against them.

export const MIN_OPTIONS = 4;
export const MAX_OPTIONS = 6;
export const MAX_HINTS = 4;
export const MAX_IMAGE_BYTES = 500 * 1024;

export interface McqOption {
  id: string;
  body: string;
  explanation: string;
  is_correct: boolean;
}

export interface McqQuestion {
  id: string;
  /** A pc_categories slug. */
  category_slug: string;
  position: number;
  slug: string;
  title: string;
  difficulty: Difficulty;
  topic: string;
  access: Access;
  status: QuestionStatus;
  /** The question itself (markdown). */
  description: string;
  /** Shown above the question; a pc-images questions/ address. */
  image_url: string | null;
  /** The image described in words, for screen readers and when it doesn't load. */
  image_alt: string;
  /** In order, each a stronger nudge than the last. */
  hints: string[];
  options: McqOption[];
  updated_at: string;
}

export function emptyOption(): McqOption {
  return { id: newId(), body: "", explanation: "", is_correct: false };
}

export function emptyMcq(categorySlug: string): McqQuestion {
  return {
    id: newId(),
    category_slug: categorySlug,
    position: 0,
    slug: "",
    title: "",
    difficulty: "easy",
    topic: "",
    access: "public",
    status: "draft",
    description: "",
    image_url: null,
    image_alt: "",
    hints: [""],
    options: Array.from({ length: MIN_OPTIONS }, emptyOption),
    updated_at: new Date().toISOString(),
  };
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Everything that must hold before an MCQ is published (pc_mcq_problems in the database). */
export function mcqPublishChecks(q: McqQuestion): Check[] {
  const hints = q.hints.filter((h) => h.trim() !== "").length;
  const correct = q.options.filter((o) => o.is_correct).length;
  return [
    { label: "Title, topic and category are filled in", ok: q.title.trim() !== "" && q.topic.trim() !== "" && q.category_slug !== "" },
    { label: "Slug uses lowercase letters, digits and single hyphens", ok: SLUG_RE.test(q.slug) && q.slug.length <= 64 },
    { label: "The question is written", ok: q.description.trim() !== "" },
    ...(q.image_url ? [{ label: "The image has a description", ok: q.image_alt.trim() !== "" }] : []),
    { label: `${MIN_OPTIONS} to ${MAX_OPTIONS} options (${q.options.length})`, ok: q.options.length >= MIN_OPTIONS && q.options.length <= MAX_OPTIONS },
    { label: "Exactly one option is marked correct", ok: correct === 1 },
    { label: "Every option has its text and an explanation", ok: q.options.every((o) => o.body.trim() !== "" && o.explanation.trim() !== "") },
    { label: `At least 1 hint, at most ${MAX_HINTS} (${hints})`, ok: hints >= 1 && hints <= MAX_HINTS },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Loading and saving
// ---------------------------------------------------------------------------------------------------------------

/** Under the coding questions' key, so archiving, publishing or reordering either kind reloads both. */
const MCQ_KEY = ["practice-questions", "mcq"] as const;

interface McqRow {
  id: string;
  category_id: string;
  slug: string;
  title: string;
  difficulty: Difficulty;
  topic: string;
  access: Access;
  status: "draft" | "published";
  description: string;
  image_url: string | null;
  image_alt: string;
  hints: string[];
  position: number;
  updated_at: string;
  archived_at: string | null;
  options: (McqOption & { position: number })[];
}

/** Every MCQ in the given MCQ categories (drafts and archived included). */
export function useMcqQuestions(categories: { id: string; slug: string; question_kind: string }[] | undefined) {
  const mcqCategories = (categories ?? []).filter((c) => c.question_kind === "mcq");
  return useQuery({
    queryKey: [...MCQ_KEY, mcqCategories.map((c) => c.id).join(",")],
    enabled: categories !== undefined,
    queryFn: async (): Promise<McqQuestion[]> => {
      if (mcqCategories.length === 0) return [];
      const { data, error } = await supabase
        .from("pc_questions")
        .select(
          "id, category_id, slug, title, difficulty, topic, access, status, description, image_url, image_alt, hints, position, updated_at, archived_at, options:pc_question_options(id, position, body, explanation, is_correct)",
        )
        .in(
          "category_id",
          mcqCategories.map((c) => c.id),
        )
        .order("position");
      if (error) throw new Error(error.message);
      const slugOf = new Map(mcqCategories.map((c) => [c.id, c.slug]));
      return (data as McqRow[]).map((q) => ({
        id: q.id,
        category_slug: slugOf.get(q.category_id) ?? "",
        position: q.position,
        slug: q.slug,
        title: q.title,
        difficulty: q.difficulty,
        topic: q.topic,
        access: q.access,
        status: q.archived_at ? "archived" : q.status,
        description: q.description,
        image_url: q.image_url,
        image_alt: q.image_alt,
        hints: q.hints.length ? q.hints : [""],
        options: [...q.options]
          .sort((a, b) => a.position - b.position)
          .map(({ id, body, explanation, is_correct }) => ({ id, body, explanation, is_correct })),
        updated_at: q.updated_at,
      }));
    },
  });
}

/** Saves the whole MCQ (fields, image, hints, options) and returns its id. */
export function useSaveMcq() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, categoryId, question: q }: { id: string | null; categoryId: string; question: McqQuestion }) => {
      const { data, error } = await supabase.rpc("pc_mcq_save", {
        p_question_id: id,
        p_category_id: categoryId,
        p_slug: q.slug,
        p_title: q.title,
        p_difficulty: q.difficulty,
        p_topic: q.topic,
        p_access: q.access,
        p_description: q.description,
        p_image_url: q.image_url,
        p_image_alt: q.image_alt,
        p_hints: q.hints,
        p_options: q.options.map(({ id: optionId, body, explanation, is_correct }) => ({ id: optionId, body, explanation, is_correct })),
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["practice-questions"] }),
  });
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Uploads a question's image to pc-images/questions/ and returns its address. */
export async function uploadQuestionImage(file: File): Promise<string> {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error("Use a PNG, JPG or WebP image");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("The image must be 500 KB or smaller");
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `questions/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("pc-images").upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);
  return supabase.storage.from("pc-images").getPublicUrl(path).data.publicUrl;
}

// ---------------------------------------------------------------------------------------------------------------
// AI drafts (the practice-ai Edge Function picks MCQ rules for an MCQ card)
// ---------------------------------------------------------------------------------------------------------------

/** What the function returns for an MCQ card (McqDraft in practice-ai/rules.ts). */
export interface GeneratedMcq {
  title: string;
  slug: string;
  difficulty: Difficulty;
  topic: string;
  description: string;
  options: { body: string; explanation: string; is_correct: boolean }[];
  hints: string[];
  /** How the AI solved it, for the author to check. Not saved. */
  working: string;
}

export function useGenerateMcq() {
  return useMutation({
    mutationFn: async ({ categoryId, prompt }: { categoryId: string; prompt: string }): Promise<GeneratedMcq> => {
      const { data, error } = await supabase.functions.invoke("practice-ai", { body: { category_id: categoryId, prompt } });
      if (error) {
        if (error instanceof FunctionsHttpError) {
          const payload = await error.context.json().catch(() => null);
          throw new Error(payload?.error ?? "Couldn't generate the question");
        }
        throw new Error(error.message);
      }
      return (data as { question: GeneratedMcq }).question;
    },
  });
}

/** The draft applied to the question being written. Keeps what isn't the AI's: id, category, access, status, image. */
export function applyGeneratedMcq(q: McqQuestion, g: GeneratedMcq): McqQuestion {
  return {
    ...q,
    title: g.title ?? "",
    slug: g.slug ?? "",
    difficulty: (["easy", "medium", "hard"] as const).includes(g.difficulty) ? g.difficulty : q.difficulty,
    topic: g.topic ?? "",
    description: g.description ?? "",
    hints: g.hints?.length ? g.hints.slice(0, MAX_HINTS) : [""],
    options: (g.options ?? []).slice(0, MAX_OPTIONS).map((o) => ({
      id: newId(),
      body: o.body ?? "",
      explanation: o.explanation ?? "",
      is_correct: o.is_correct === true,
    })),
  };
}

/** A new random order of the option ids (Fisher–Yates), as PrepCode shuffles them. */
export function shuffled(ids: string[]): string[] {
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
