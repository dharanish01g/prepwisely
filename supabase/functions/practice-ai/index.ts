// Drafts a Practice coding question with Gemini from the author's description. POST { category_id, prompt }.
//   200 { question }   a checked draft (shape: Draft in rules.ts); nothing is saved, the editor shows it
//   400 { error }      bad body or request (too short, too long)
//   401 { error }      no or invalid session
//   403 { error }      not superadmin or content manager (pc_can_manage)
//   404 { error }      category not found
//   422 { error }      refused: the request isn't a coding practice question
//   429 { error }      over a limit (20 an hour, 100 a day per person; 500 a day in all; pc_ai_generation_start)
//   502 { error }      Gemini failed, or its draft failed the checks in rules.ts
// Every request is logged in pc_ai_generations (migration 20261013172848) with its outcome and tokens.
// Secret: GEMINI_API_KEY (Google Cloud project "prepcode", restricted to the Generative Language API).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildRequest, checkDraft, cleanPrompt, MODEL } from "./rules.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const geminiKey = Deno.env.get("GEMINI_API_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const fail = (status: number, error: string) => json({ error }, status);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail(405, "Method not allowed");
  if (!geminiKey) {
    console.error("practice-ai: GEMINI_API_KEY is not set");
    return fail(500, "AI generation isn't set up yet");
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return fail(401, "Missing authorization");
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return fail(401, "Invalid session");

  const { data: canManage, error: roleError } = await userClient.rpc("pc_can_manage");
  if (roleError) return fail(500, roleError.message);
  if (canManage !== true) return fail(403, "Only superadmins and content managers can generate questions");

  if (Number(req.headers.get("content-length") ?? 0) > 20000) return fail(400, "Request too large");
  let body: { category_id?: unknown; prompt?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Body must be JSON");
  }
  if (typeof body !== "object" || body === null) return fail(400, "Body must be a JSON object");
  const categoryId = typeof body.category_id === "string" ? body.category_id : "";
  if (!UUID_RE.test(categoryId)) return fail(400, "Choose a category first");
  const cleaned = cleanPrompt(body.prompt);
  if ("error" in cleaned) return fail(400, cleaned.error);

  // The category, and what it already has, so the draft fits and doesn't repeat (read as the caller, under RLS).
  const { data: category, error: categoryError } = await userClient
    .from("pc_categories")
    .select("title, description, pc_domains(title)")
    .eq("id", categoryId)
    .maybeSingle();
  if (categoryError) return fail(500, categoryError.message);
  if (!category) return fail(404, "Category not found");
  const { data: existing, error: existingError } = await userClient
    .from("pc_questions")
    .select("title, slug, method")
    .eq("category_id", categoryId)
    .order("position")
    .limit(200);
  if (existingError) return fail(500, existingError.message);

  // Logged, and refused over a limit, before any credit is spent.
  const { data: logId, error: limitError } = await userClient.rpc("pc_ai_generation_start", {
    p_category_id: categoryId,
    p_prompt: cleaned.prompt,
  });
  if (limitError) return fail(limitError.code === "P0001" ? 429 : 500, limitError.message);

  let promptTokens = 0;
  let outputTokens = 0;
  async function finish(status: "ok" | "refused" | "failed", detail: string) {
    const { error } = await userClient.rpc("pc_ai_generation_finish", {
      p_id: logId,
      p_status: status,
      p_detail: detail,
      p_prompt_tokens: promptTokens,
      p_output_tokens: outputTokens,
    });
    if (error) console.error("practice-ai: couldn't log the outcome:", error.message);
  }

  const request = buildRequest(
    {
      domain: (category.pc_domains as unknown as { title: string } | null)?.title ?? "",
      title: category.title,
      description: category.description ?? "",
      existing: existing ?? [],
    },
    cleaned.prompt,
  );

  let response: Response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("practice-ai: Gemini unreachable:", message);
    await finish("failed", `unreachable: ${message}`);
    return fail(502, "Couldn't reach the AI service. Try again.");
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`practice-ai: Gemini ${response.status}:`, detail.slice(0, 500));
    await finish("failed", `gemini ${response.status}`);
    if (response.status === 402) return fail(502, "The AI service is out of credit. Top up Gemini in AI Studio.");
    if (response.status === 429 || response.status === 503) return fail(502, "The AI service is busy. Try again in a minute.");
    return fail(502, "The AI service refused the request. Try again.");
  }

  const result = await response.json().catch(() => null);
  promptTokens = Number(result?.usageMetadata?.promptTokenCount ?? 0);
  outputTokens = Number(result?.usageMetadata?.candidatesTokenCount ?? 0);
  const candidate = result?.candidates?.[0];
  if (!candidate || candidate.finishReason === "SAFETY" || result?.promptFeedback?.blockReason) {
    await finish("refused", `blocked: ${candidate?.finishReason ?? result?.promptFeedback?.blockReason ?? "no answer"}`);
    return fail(422, "The AI declined this request. Describe a coding practice question.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse((candidate.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join(""));
  } catch {
    await finish("failed", `not JSON (${candidate.finishReason})`);
    return fail(502, "The AI answered in the wrong shape. Try again.");
  }

  const checked = checkDraft(raw);
  if (!checked.ok) {
    await finish(checked.refused ? "refused" : "failed", checked.error);
    return checked.refused ? fail(422, `Not generated: ${checked.error}`) : fail(502, `${checked.error}. Try again.`);
  }
  await finish("ok", checked.draft.title);
  return json({ question: checked.draft });
});
