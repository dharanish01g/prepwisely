import { useEffect } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { UpdateState } from "@/updater";

const AUTO_HIDE_MS = 3_000;

interface UpdateBannerProps {
  state: UpdateState;
  onInstall: () => void;
  onDismiss: () => void;
}

/**
 * Non-blocking update notification. Shows when an update is found and
 * downloading, when it's ready to apply, and the result of a manual check.
 */
export function UpdateBanner({ state, onInstall, onDismiss }: UpdateBannerProps) {
  const autoHide = state.status === "up-to-date" || state.status === "error";

  useEffect(() => {
    if (!autoHide) return;
    const timer = setTimeout(onDismiss, AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [autoHide, state, onDismiss]);

  if (state.status === "idle") return null;

  let title: string;
  let description: string | null = null;
  let progress: number | null | undefined;
  let spinner = false;
  let actions: React.ReactNode = null;

  switch (state.status) {
    case "checking":
      title = "Checking for updates…";
      spinner = true;
      break;
    case "up-to-date":
      title = "You're up to date";
      description = `Running version ${state.version}.`;
      break;
    case "error":
      title = "Update check failed";
      description = state.message;
      break;
    case "downloading":
      title = `Update ${state.version} available`;
      description = "Downloading in the background…";
      progress = state.contentLength ? Math.round((state.downloaded / state.contentLength) * 100) : null;
      spinner = true;
      break;
    case "ready":
      title = `Update ${state.version} is ready`;
      description = "Restart to apply it.";
      actions = (
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Later
          </Button>
          <Button size="sm" onClick={onInstall}>
            Restart
          </Button>
        </div>
      );
      break;
    case "installing":
      title = "Installing update…";
      spinner = true;
      break;
  }

  return (
    <div
      role="status"
      className="fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2 rounded-lg border bg-background p-3 text-left shadow-lg"
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 text-sm">
          <p className="flex items-center gap-2 font-medium">
            {spinner && <Loader2Icon className="size-4 animate-spin" />}
            {title}
          </p>
          {description && <p className="text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {progress !== undefined && <Progress value={progress} />}
    </div>
  );
}
