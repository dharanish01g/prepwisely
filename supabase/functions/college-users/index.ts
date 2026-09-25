// College-side accounts (students for now). One endpoint, four actions:
//   create          { batch_id, full_name, email, roll_number, phone? }
//   import          { batch_id, students: [{ row, full_name, email, roll_number, phone? }] }   (all or nothing)
//   reset_password  { student_id }                        (back to the batch code without dashes)
//   set_status      { student_id, status: "active" | "inactive" }
// A student signs in with email + password. The first password is their batch code without dashes (SEC-CSE-2028-B01
// gives SECCSE2028B01); changing it later is up to the student (the app asks for 8+ characters when they do).
// Nothing here deletes students (an import that fails part-way removes only the accounts it just made).
// Caller must be an active superadmin (any college) or an onboarding manager assigned to the student's college.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ROLL_LENGTH = 30;
const MAX_IMPORT_ROWS = 500;
const CREATE_CONCURRENCY = 5;
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

/** A batch's starting password: its code without dashes (always longer than Supabase's 6-character minimum). */
const batchPassword = (batchCode: string) => batchCode.replace(/-/g, "");

type Admin = ReturnType<typeof createClient>;
type UserClient = ReturnType<typeof createClient>;

interface Caller {
  id: string;
  isSuperadmin: boolean;
  client: UserClient;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail(405, "Method not allowed");

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return fail(401, "Missing authorization");

  // Identify the caller with their own JWT, then require an active superadmin or onboarding manager.
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return fail(401, "Invalid session");

  const { data: isSuperadmin, error: superError } = await userClient.rpc("is_superadmin");
  if (superError) return fail(500, "Could not verify permissions");
  if (!isSuperadmin) {
    const { data: isManager, error: managerError } = await userClient.rpc("has_role", { p_role_id: "onboarding_manager" });
    if (managerError) return fail(500, "Could not verify permissions");
    if (!isManager) return fail(403, "Not authorized");
  }
  const caller: Caller = { id: userData.user.id, isSuperadmin: !!isSuperadmin, client: userClient };

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON");
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  switch (body.action) {
    case "create":
      return await createOne(admin, caller, body);
    case "import":
      return await importMany(admin, caller, body);
    case "reset_password":
      return await resetPassword(admin, caller, body);
    case "set_status":
      return await setStatus(admin, caller, body);
    default:
      return fail(400, "Unknown action");
  }
});

/** Superadmin may act on any college; a manager only on colleges assigned to them. */
async function canManageCollege(caller: Caller, collegeId: string): Promise<boolean> {
  if (caller.isSuperadmin) return true;
  const { data, error } = await caller.client.rpc("is_assigned_college", { p_college_id: collegeId });
  return !error && data === true;
}

/** Looks up the batch and checks the caller may add students to it. Returns an error response or the batch. */
async function loadBatch(admin: Admin, caller: Caller, batchId: string) {
  if (!batchId) return { error: fail(400, "batch_id is required") };
  const { data: batch, error } = await admin.from("batches").select("id, college_id, code, archived_at").eq("id", batchId).maybeSingle();
  if (error) return { error: fail(500, "Could not load batch") };
  if (!batch || !(await canManageCollege(caller, batch.college_id as string))) return { error: fail(404, "Batch not found") };
  if (batch.archived_at) return { error: fail(400, "This batch is archived. Restore it before adding students.") };
  return { batch: batch as { id: string; college_id: string; code: string } };
}

interface StudentInput {
  row: number;
  full_name: string;
  email: string;
  roll_number: string;
  phone: string;
}

function readStudent(raw: Record<string, unknown>, row: number): StudentInput {
  return {
    row,
    full_name: str(raw.full_name),
    email: str(raw.email).toLowerCase(),
    roll_number: str(raw.roll_number),
    phone: str(raw.phone),
  };
}

/** Field-level problems with one student, before touching the database. */
function validate(s: StudentInput): string[] {
  const problems: string[] = [];
  if (!s.full_name) problems.push("Full name is required");
  if (!EMAIL_RE.test(s.email)) problems.push("A valid email is required");
  if (!s.roll_number) problems.push("Roll number is required");
  else if (s.roll_number.length > MAX_ROLL_LENGTH) problems.push(`Roll number can be at most ${MAX_ROLL_LENGTH} characters`);
  return problems;
}

/** Emails already used by any account, and roll numbers already used in this college (lower-cased). */
async function existingConflicts(admin: Admin, collegeId: string, emails: string[]) {
  const [students, staff, rolls] = await Promise.all([
    admin.from("students").select("email").in("email", emails),
    admin.from("profiles").select("email").in("email", emails),
    admin.from("students").select("roll_number").eq("college_id", collegeId),
  ]);
  if (students.error || staff.error || rolls.error) throw new Error("Could not check existing accounts");
  return {
    emails: new Set([...students.data, ...staff.data].map((r) => (r.email as string).toLowerCase())),
    rolls: new Set(rolls.data.map((r) => (r.roll_number as string).toLowerCase())),
  };
}

/** Creates the auth user and the student row; removes the auth user again if the row can't be written. */
async function createAccount(
  admin: Admin,
  callerId: string,
  batch: { id: string; code: string },
  s: StudentInput,
): Promise<{ id?: string; error?: string }> {
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: s.email,
    password: batchPassword(batch.code),
    email_confirm: true,
  });
  if (createError || !created.user) {
    const exists = createError?.code === "email_exists" || /already/i.test(createError?.message ?? "");
    return { error: exists ? "A user with this email already exists" : (createError?.message ?? "Could not create account") };
  }
  const { error: rowError } = await admin.rpc("college_create_student", {
    p_id: created.user.id,
    p_batch_id: batch.id,
    p_full_name: s.full_name,
    p_email: s.email,
    p_roll_number: s.roll_number,
    p_phone: s.phone,
    p_created_by: callerId,
  });
  if (rowError) {
    await admin.auth.admin.deleteUser(created.user.id);
    const message = rowError.message;
    if (message.includes("students_college_roll_key")) return { error: "This roll number is already used in this college" };
    if (message.includes("students_email_key")) return { error: "A user with this email already exists" };
    if (message === "Batch is archived") return { error: "This batch is archived. Restore it before adding students." };
    return { error: "Could not create student" };
  }
  return { id: created.user.id };
}

async function createOne(admin: Admin, caller: Caller, body: Record<string, unknown>) {
  const loaded = await loadBatch(admin, caller, str(body.batch_id));
  if (loaded.error) return loaded.error;
  const student = readStudent(body, 1);
  const problems = validate(student);
  if (problems.length) return fail(400, problems[0]);

  let conflicts;
  try {
    conflicts = await existingConflicts(admin, loaded.batch.college_id, [student.email]);
  } catch (e) {
    return fail(500, (e as Error).message);
  }
  if (conflicts.emails.has(student.email)) return fail(409, "A user with this email already exists");
  if (conflicts.rolls.has(student.roll_number.toLowerCase())) return fail(409, "This roll number is already used in this college");

  const result = await createAccount(admin, caller.id, loaded.batch, student);
  if (result.error) return fail(409, result.error);
  return json({ id: result.id }, 201);
}

// All or nothing: every row is checked first (fields, duplicates inside the file, clashes with existing accounts);
// if anything is wrong, nothing is created and every problem is returned by row. If creation still fails part-way
// (e.g. an email taken a moment ago), the accounts made so far are removed again.
async function importMany(admin: Admin, caller: Caller, body: Record<string, unknown>) {
  const loaded = await loadBatch(admin, caller, str(body.batch_id));
  if (loaded.error) return loaded.error;
  if (!Array.isArray(body.students) || body.students.length === 0) return fail(400, "No students to import");
  if (body.students.length > MAX_IMPORT_ROWS) return fail(400, `At most ${MAX_IMPORT_ROWS} students per import`);

  const students = (body.students as Record<string, unknown>[]).map((raw, i) =>
    readStudent(raw ?? {}, typeof raw?.row === "number" ? raw.row : i + 2),
  );

  let conflicts;
  try {
    conflicts = await existingConflicts(admin, loaded.batch.college_id, students.map((s) => s.email).filter(Boolean));
  } catch (e) {
    return fail(500, (e as Error).message);
  }

  const errors: { row: number; message: string }[] = [];
  const seenEmails = new Map<string, number>();
  const seenRolls = new Map<string, number>();
  for (const s of students) {
    const problems = validate(s);
    const rollKey = s.roll_number.toLowerCase();
    if (s.email && seenEmails.has(s.email)) problems.push(`Same email as row ${seenEmails.get(s.email)}`);
    else if (conflicts.emails.has(s.email)) problems.push("A user with this email already exists");
    if (rollKey && seenRolls.has(rollKey)) problems.push(`Same roll number as row ${seenRolls.get(rollKey)}`);
    else if (conflicts.rolls.has(rollKey)) problems.push("This roll number is already used in this college");
    if (s.email && !seenEmails.has(s.email)) seenEmails.set(s.email, s.row);
    if (rollKey && !seenRolls.has(rollKey)) seenRolls.set(rollKey, s.row);
    for (const message of problems) errors.push({ row: s.row, message });
  }
  if (errors.length) return json({ error: "Fix the rows below and import again. Nothing was imported.", errors }, 400);

  const createdIds: string[] = [];
  for (let i = 0; i < students.length; i += CREATE_CONCURRENCY) {
    const chunk = students.slice(i, i + CREATE_CONCURRENCY);
    const results = await Promise.all(chunk.map((s) => createAccount(admin, caller.id, loaded.batch, s)));
    results.forEach((r) => r.id && createdIds.push(r.id));
    const failedAt = results.findIndex((r) => r.error);
    if (failedAt !== -1) {
      await removeAccounts(admin, createdIds);
      return json(
        {
          error: "Import stopped and was undone. Nothing was imported.",
          errors: [{ row: chunk[failedAt].row, message: results[failedAt].error! }],
        },
        409,
      );
    }
  }
  return json({ created: createdIds.length }, 201);
}

/** Undo for a failed import only: removes accounts this request just created. */
async function removeAccounts(admin: Admin, ids: string[]) {
  if (!ids.length) return;
  await admin.from("students").delete().in("id", ids);
  await Promise.all(ids.map((id) => admin.auth.admin.deleteUser(id)));
}

/** Looks up the student and checks the caller may manage them. */
async function loadStudent(admin: Admin, caller: Caller, studentId: string) {
  if (!studentId) return { error: fail(400, "student_id is required") };
  const { data, error } = await admin
    .from("students")
    .select("id, college_id, status, batches(code)")
    .eq("id", studentId)
    .maybeSingle();
  if (error) return { error: fail(500, "Could not load student") };
  if (!data || !(await canManageCollege(caller, data.college_id as string))) return { error: fail(404, "Student not found") };
  const batch = data.batches as unknown as { code: string };
  return { student: { id: data.id as string, college_id: data.college_id as string, status: data.status as string, batch_code: batch.code } };
}

async function resetPassword(admin: Admin, caller: Caller, body: Record<string, unknown>) {
  const loaded = await loadStudent(admin, caller, str(body.student_id));
  if (loaded.error) return loaded.error;
  const { error } = await admin.auth.admin.updateUserById(loaded.student.id, { password: batchPassword(loaded.student.batch_code) });
  if (error) return fail(400, error.message);
  return json({ ok: true });
}

async function setStatus(admin: Admin, caller: Caller, body: Record<string, unknown>) {
  const status = body.status;
  if (status !== "active" && status !== "inactive") return fail(400, "status must be active or inactive");
  const loaded = await loadStudent(admin, caller, str(body.student_id));
  if (loaded.error) return loaded.error;
  const { id, status: previous } = loaded.student;

  const { error: updateError } = await admin.from("students").update({ status }).eq("id", id);
  if (updateError) return fail(500, "Could not update status");

  const { error: banError } = await admin.auth.admin.updateUserById(id, {
    ban_duration: status === "inactive" ? BAN_FOREVER : "none",
  });
  if (banError) {
    await admin.from("students").update({ status: previous }).eq("id", id);
    return fail(500, "Could not update sign-in access");
  }
  return json({ ok: true, status });
}
