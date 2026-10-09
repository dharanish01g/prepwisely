// Deletes the caller's own account while it's still waiting for GitHub. POST, no body.
// A student who starts with Google gets an account that prepcode can't use until they connect GitHub. If the GitHub
// they pick already has a prepcode account, prepcode signs them in to that one instead and adds the Gmail there; the
// waiting account has to go first, since a Google login can belong to only one account.
//   200 { ok: true }
//   401 { error }   no or invalid session
//   409 { error }   the account isn't a waiting one (it has GitHub, or a staff, student, faculty or TPO row)
// Only ever deletes the caller's own account, and never one prepcode or prepwisely uses.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail(405, "Method not allowed");

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return fail(401, "Missing authorization");

  // Identify the caller with their own JWT.
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return fail(401, "Invalid session");
  const user = userData.user;

  if (user.identities?.some((i) => i.provider === "github")) {
    return fail(409, "This account has GitHub connected, so it isn't deleted");
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  for (const table of ["profiles", "students", "faculty", "tpo"]) {
    const { data, error } = await admin.from(table).select("id").eq("id", user.id).maybeSingle();
    if (error) return fail(500, "Could not check the account");
    if (data) return fail(409, "This account is in use, so it isn't deleted");
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) return fail(500, "Could not delete the account");
  return json({ ok: true });
});
