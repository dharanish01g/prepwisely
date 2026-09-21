import { Loader2Icon, TriangleAlertIcon, WifiOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ConnectionBannerProps {
  offline: boolean;
  failed: boolean;
  retrying: boolean;
  onRetry: () => void;
}

/** Explains why the sidebar is disabled or empty. Renders nothing when everything is fine. */
export function ConnectionBanner({ offline, failed, retrying, onRetry }: ConnectionBannerProps) {
  if (!offline && !failed) return null;

  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b bg-muted px-4 py-2 text-xs text-muted-foreground"
    >
      {offline ? <WifiOffIcon className="size-3.5 shrink-0" /> : <TriangleAlertIcon className="size-3.5 shrink-0" />}
      <span className="flex-1">
        {offline
          ? "You're offline. Pages are disabled until your connection is back."
          : "Couldn't load your pages. Check your connection and try again."}
      </span>
      <Button variant="outline" size="xs" onClick={onRetry} disabled={retrying}>
        {retrying && <Loader2Icon className="animate-spin" />}
        {retrying ? "Retrying…" : "Retry"}
      </Button>
    </div>
  );
}
