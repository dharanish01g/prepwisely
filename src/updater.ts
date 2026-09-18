import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "downloading"; downloaded: number; contentLength?: number }
  | { state: "installing" }
  | { state: "relaunching" }
  | { state: "error"; message: string };

export async function checkForUpdates(onStatus: (status: UpdateStatus) => void) {
  onStatus({ state: "checking" });

  const update = await check();
  if (!update) {
    onStatus({ state: "idle" });
    return;
  }

  let downloaded = 0;
  let contentLength: number | undefined;

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        contentLength = event.data.contentLength;
        onStatus({ state: "downloading", downloaded: 0, contentLength });
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onStatus({ state: "downloading", downloaded, contentLength });
        break;
      case "Finished":
        onStatus({ state: "installing" });
        break;
    }
  });

  onStatus({ state: "relaunching" });
  await relaunch();
}
