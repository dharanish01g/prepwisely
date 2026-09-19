import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";

export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date"; version: string }
  | { status: "error"; message: string }
  | { status: "downloading"; version: string; downloaded: number; contentLength?: number }
  | { status: "ready"; version: string; notes?: string }
  | { status: "installing"; version: string };

const STARTUP_DELAY_MS = 5_000;
const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 10_000;

let pending: Update | null = null;
let busy = false;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Update check timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * `manual` checks (user clicked "Check for updates") also report checking,
 * up-to-date and error states. Background checks only surface an update
 * once one is found.
 */
async function checkAndDownload(onState: (state: UpdateState) => void, manual = false) {
  if (pending) {
    if (manual) onState({ status: "ready", version: pending.version, notes: pending.body });
    return;
  }
  if (busy) return;
  busy = true;
  try {
    if (manual) onState({ status: "checking" });
    const update = await withTimeout(check(), CHECK_TIMEOUT_MS);
    if (!update) {
      if (manual) onState({ status: "up-to-date", version: await getVersion() });
      else onState({ status: "idle" });
      return;
    }

    let downloaded = 0;
    let contentLength: number | undefined;
    onState({ status: "downloading", version: update.version, downloaded, contentLength });

    await update.download((event) => {
      switch (event.event) {
        case "Started":
          contentLength = event.data.contentLength;
          break;
        case "Progress":
          downloaded += event.data.chunkLength;
          onState({ status: "downloading", version: update.version, downloaded, contentLength });
          break;
      }
    });

    pending = update;
    onState({ status: "ready", version: update.version, notes: update.body });
  } catch (err) {
    console.warn("[updater] update failed:", err);
    if (manual) onState({ status: "error", message: "Couldn't check for updates. Please try again." });
    else onState({ status: "idle" });
  } finally {
    busy = false;
  }
}

/** User-initiated check; reports every outcome through `onState`. */
export function checkNow(onState: (state: UpdateState) => void) {
  return checkAndDownload(onState, true);
}

/**
 * Checks for an update shortly after launch and then periodically, downloading
 * it silently. `onState` fires `ready` once the package is on disk and waiting
 * for the user to apply it. Returns a cleanup function.
 */
export function startBackgroundUpdates(onState: (state: UpdateState) => void): () => void {
  const first = setTimeout(() => void checkAndDownload(onState), STARTUP_DELAY_MS);
  const interval = setInterval(() => void checkAndDownload(onState), RECHECK_INTERVAL_MS);
  return () => {
    clearTimeout(first);
    clearInterval(interval);
  };
}

/** Installs the already-downloaded update and restarts the app. */
export async function installAndRelaunch(onState: (state: UpdateState) => void) {
  if (!pending) return;
  onState({ status: "installing", version: pending.version });
  try {
    await pending.install();
    await relaunch();
  } catch (err) {
    console.error("[updater] install failed:", err);
    // Drop the staged package so the next interval re-downloads a fresh one.
    pending = null;
    onState({ status: "idle" });
  }
}
