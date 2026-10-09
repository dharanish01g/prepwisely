// A GitHub token for the signed-in student's `prepcode-programs` repo, so prepcode can sync. POST, no body.
// If the prepcodes app is installed but the repo doesn't exist yet, it's created here first (public, with a README).
//   200 { token, expires_at, github_login }   token works on that one repo only (contents: write) for one hour
//   401 { error }                             no or invalid session
//   403 { error, code: "no_github" }          the account has no GitHub sign-in
//   404 { error, code: "not_installed" }      the prepcodes GitHub App isn't installed on the student's GitHub account
//   409 { error, code: "repo_not_selected", repo_id, installation_id }
//                                             installed, but not on the existing `prepcode-programs` repo (repo_id
//                                             is null when GitHub didn't say which repo it is)
//   409 { error, code: "cannot_create_repo", installation_id }
//                                             installed, no repo, and GitHub refused to create it (e.g. the
//                                             installation hasn't accepted the "Repository creation" permission)
//   502 { error }                             GitHub didn't answer as expected
// Nothing is stored, and the token is never logged. The app keeps it in memory until it expires.
// Secrets: GITHUB_APP_ID (the prepcodes app's id) and GITHUB_APP_PRIVATE_KEY (its .pem, as GitHub downloads it).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const appId = Deno.env.get("GITHUB_APP_ID") ?? "";
const privateKeyPem = Deno.env.get("GITHUB_APP_PRIVATE_KEY") ?? "";

const REPO = "prepcode-programs";
const GITHUB_API = "https://api.github.com";

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

const fail = (status: number, error: string, code?: string) => json(code ? { error, code } : { error }, status);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail(405, "Method not allowed");
  if (!appId || !privateKeyPem) {
    console.error("github-token: GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY is not set");
    return fail(500, "Syncing isn't set up yet");
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return fail(401, "Missing authorization");

  // Identify the caller with their own JWT.
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return fail(401, "Invalid session");

  // The GitHub account this Supabase account signed up with. Its numeric id never changes; the username can.
  const identity = userData.user.identities?.find((i) => i.provider === "github");
  const githubId = String(identity?.identity_data?.provider_id ?? identity?.identity_data?.sub ?? "");
  const githubLogin = String(identity?.identity_data?.user_name ?? "");
  if (!githubId || !githubLogin) return fail(403, "Sign in with GitHub to sync", "no_github");

  let appJwt: string;
  try {
    appJwt = await createAppJwt();
  } catch (err) {
    console.error("github-token: could not sign the app JWT:", err instanceof Error ? err.message : err);
    return fail(500, "Syncing isn't set up correctly");
  }

  // The app's installation on the student's account. Matched by id too, in case the username now belongs to
  // someone else (renamed since their last sign-in).
  const found = await github(`/users/${encodeURIComponent(githubLogin)}/installation`, appJwt);
  if (found.status === 404) return fail(404, "Connect GitHub to sync", "not_installed");
  if (!found.ok) return githubFailure("find installation", found);
  const installation = await found.json();
  if (String(installation.account?.id) !== githubId) return fail(404, "Connect GitHub to sync", "not_installed");

  let created = await repoToken(installation.id, appJwt);
  // GitHub answers 422 when the repo isn't one the installation can reach (not selected, or doesn't exist).
  if (created.status === 422) {
    const setUp = await setUpRepo(installation, appJwt);
    if (setUp) return setUp;
    created = await repoToken(installation.id, appJwt);
    if (created.status === 422) return notSelected(installation.id, null);
  }
  if (!created.ok) return githubFailure("create token", created);
  const access = await created.json();

  return json({ token: access.token, expires_at: access.expires_at, github_login: installation.account.login });
});

// A token for the one repo only, with only what syncing needs.
function repoToken(installationId: number, appJwt: string) {
  return github(`/app/installations/${installationId}/access_tokens`, appJwt, {
    repositories: [REPO],
    permissions: { contents: "write", metadata: "read" },
  });
}

function notSelected(installationId: number, repoId: number | null) {
  return json(
    {
      error: `Give prepcodes access to your ${REPO} repository to sync`,
      code: "repo_not_selected",
      repo_id: repoId,
      installation_id: installationId,
    },
    409,
  );
}

// The installation can't reach the repo: if the repo exists, the student has to add it to the installation (an
// answer to send back). If it doesn't, it's created with the installation's own token, and null is returned so
// the caller asks for the repo's token again.
// deno-lint-ignore no-explicit-any
async function setUpRepo(installation: any, appJwt: string): Promise<Response | null> {
  const owner = installation.account.login;
  const tokenResponse = await github(`/app/installations/${installation.id}/access_tokens`, appJwt, {});
  if (!tokenResponse.ok) return githubFailure("create installation token", tokenResponse);
  const { token } = await tokenResponse.json();

  // GitHub redirects a renamed repo's old name to it. A renamed repo isn't the one prepcode syncs with, so only a
  // repo with exactly this name counts; creating one then replaces the redirect.
  const existing = await github(`/repos/${encodeURIComponent(owner)}/${REPO}`, token);
  if (existing.ok) {
    const repo = await existing.json();
    if (repo.name === REPO && String(repo.owner?.id) === String(installation.account.id)) {
      return notSelected(installation.id, repo.id);
    }
  } else if (existing.status !== 404) {
    return githubFailure("find repo", existing);
  }

  const created = await github("/user/repos", token, {
    name: REPO,
    description: "Programs saved from prepcode",
    private: false,
    auto_init: true,
  });
  if (created.ok) {
    console.log(`github-token: created ${REPO} for installation ${installation.id}`);
    return null;
  }
  const detail = await created.text().catch(() => "");
  console.error(`github-token: create repo failed: ${created.status} ${detail.slice(0, 300)}`);
  // 422: the name is taken, i.e. the repo exists but this installation can't see it.
  if (created.status === 422) return notSelected(installation.id, null);
  if (created.status === 403) {
    return json(
      {
        error: `prepcodes couldn't create your ${REPO} repository`,
        code: "cannot_create_repo",
        installation_id: installation.id,
      },
      409,
    );
  }
  return fail(502, "GitHub didn't respond as expected. Please try again.");
}

// Authorized with the app's JWT, or with an installation token.
function github(path: string, bearer: string, body?: unknown) {
  return fetch(`${GITHUB_API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${bearer}`,
      "User-Agent": "prepcode",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function githubFailure(what: string, response: Response) {
  const detail = await response.text().catch(() => "");
  console.error(`github-token: ${what} failed: ${response.status} ${detail.slice(0, 300)}`);
  return fail(502, "GitHub didn't respond as expected. Please try again.");
}

// --- The app's own identity: a short JWT signed with its private key (RS256) ---------------------------------------

let signingKey: Promise<CryptoKey> | null = null;

async function createAppJwt() {
  signingKey ??= importPrivateKey(privateKeyPem);
  const key = await signingKey.catch((err) => {
    signingKey = null;
    throw err;
  });
  const now = Math.floor(Date.now() / 1000);
  // Backdated a minute for clock drift; GitHub allows at most 10 minutes of validity.
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64url(new TextEncoder().encode(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId })));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
}

// GitHub downloads the key as PKCS#1 ("BEGIN RSA PRIVATE KEY"); Web Crypto only imports PKCS#8, so wrap it.
async function importPrivateKey(pem: string) {
  const text = pem.replace(/\\n/g, "\n");
  const isPkcs1 = text.includes("BEGIN RSA PRIVATE KEY");
  const der = Uint8Array.from(atob(text.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    isPkcs1 ? pkcs1ToPkcs8(der) : der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function pkcs1ToPkcs8(pkcs1: Uint8Array) {
  const version = [0x02, 0x01, 0x00];
  // AlgorithmIdentifier: rsaEncryption (1.2.840.113549.1.1.1), NULL parameters.
  const algorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const key = [0x04, ...derLength(pkcs1.length), ...pkcs1];
  const body = [...version, ...algorithm, ...key];
  return new Uint8Array([0x30, ...derLength(body.length), ...body]);
}

function derLength(length: number) {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  for (let n = length; n > 0; n >>= 8) bytes.unshift(n & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
