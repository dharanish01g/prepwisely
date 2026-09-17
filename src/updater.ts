import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export async function checkForUpdates() {
  const update = await check();
  if (!update) return;

  await update.downloadAndInstall();
  await relaunch();
}
