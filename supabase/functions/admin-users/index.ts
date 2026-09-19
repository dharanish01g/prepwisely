// Superadmin-only staff management. One endpoint, four actions:
//   create          { full_name, email, password, role_id, phone?, address? }
//   update          { user_id, full_name, phone?, address? }
//   reset_password  { user_id, password }
//   set_status      { user_id, status: "active" | "inactive" }
// Nothing here deletes users. Writes use the service role; the caller must be an active superadmin.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Supabase has no "disable user" flag; a very long ban blocks sign-in and token refresh.
const BAN_FOREVER = "876000h";

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

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail(405, "Method not allowed");

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return fail(401, "Missing authorization");

  // Identify the caller with their own JWT, then require an active superadmin.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return fail(401, "Invalid session");
  const callerId = userData.user.id;

  const { data: isSuperadmin, error: roleError } = await userClient.rpc("is_superadmin");
  if (roleError) return fail(500, "Could not verify permissions");
  if (!isSuperadmin) return fail(403, "Superadmin only");

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON");
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  switch (body.action) {
    case "create":
      return await createUser(admin, callerId, body);
    case "update":
      return await updateUser(admin, body);
    case "reset_password":
      return await resetPassword(admin, body);
    case "set_status":
      return await setStatus(admin, callerId, body);
    default:
      return fail(400, "Unknown action");
  }
});

type Admin = ReturnType<typeof createClient>;

async function createUser(admin: Admin, callerId: string, body: Record<string, unknown>) {
  const fullName = str(body.full_name);
  const email = str(body.email).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  const roleId = str(body.role_id);
  const phone = str(body.phone) || null;
  const address = str(body.address) || null;

  if (!fullName) return fail(400, "Full name is required");
  if (!EMAIL_RE.test(email)) return fail(400, "A valid email is required");
  if (password.length < MIN_PASSWORD_LENGTH) {
    return fail(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (!roleId) return fail(400, "Role is required");

  const { data: role, error: roleError } = await admin.from("roles").select("id").eq("id", roleId).maybeSingle();
  if (roleError) return fail(500, "Could not verify role");
  if (!role) return fail(400, "Unknown role");

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !created.user) {
    const exists = createError?.code === "email_exists" || /already/i.test(createError?.message ?? "");
    return exists ? fail(409, "A user with this email already exists") : fail(400, createError?.message ?? "Could not create user");
  }
  const userId = created.user.id;

  const { error: profileError } = await admin.rpc("admin_create_profile", {
    p_id: userId,
    p_full_name: fullName,
    p_email: email,
    p_phone: phone,
    p_address: address,
    p_role_id: roleId,
    p_created_by: callerId,
  });
  if (profileError) {
    // The profile + role insert is atomic, so nothing references this auth user yet; remove the orphan.
    await admin.auth.admin.deleteUser(userId);
    return fail(500, "Could not create profile");
  }

  return json({ user: { id: userId, full_name: fullName, email, phone, address, role_id: roleId, status: "active" } }, 201);
}

// Email and role are intentionally not editable here.
async function updateUser(admin: Admin, body: Record<string, unknown>) {
  const userId = str(body.user_id);
  const fullName = str(body.full_name);
  const phone = str(body.phone) || null;
  const address = str(body.address) || null;
  if (!userId) return fail(400, "user_id is required");
  if (!fullName) return fail(400, "Full name is required");

  const { data, error } = await admin
    .from("profiles")
    .update({ full_name: fullName, phone, address })
    .eq("id", userId)
    .select("id")
    .maybeSingle();
  if (error) return fail(500, "Could not update user");
  if (!data) return fail(404, "User not found");
  return json({ ok: true });
}

async function resetPassword(admin: Admin, body: Record<string, unknown>) {
  const userId = str(body.user_id);
  const password = typeof body.password === "string" ? body.password : "";
  if (!userId) return fail(400, "user_id is required");
  if (password.length < MIN_PASSWORD_LENGTH) {
    return fail(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const { data: profile } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
  if (!profile) return fail(404, "User not found");

  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return fail(400, error.message);
  return json({ ok: true });
}

async function setStatus(admin: Admin, callerId: string, body: Record<string, unknown>) {
  const userId = str(body.user_id);
  const status = body.status;
  if (!userId) return fail(400, "user_id is required");
  if (status !== "active" && status !== "inactive") return fail(400, "status must be active or inactive");
  // Guards against locking every superadmin out.
  if (userId === callerId && status === "inactive") return fail(400, "You cannot deactivate yourself");

  const { data: profile } = await admin.from("profiles").select("id, status").eq("id", userId).maybeSingle();
  if (!profile) return fail(404, "User not found");

  const { error: updateError } = await admin.from("profiles").update({ status }).eq("id", userId);
  if (updateError) return fail(500, "Could not update status");

  const { error: banError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: status === "inactive" ? BAN_FOREVER : "none",
  });
  if (banError) {
    await admin.from("profiles").update({ status: profile.status }).eq("id", userId);
    return fail(500, "Could not update sign-in access");
  }

  return json({ ok: true, status });
}
