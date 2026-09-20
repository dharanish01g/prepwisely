import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RefreshButtonProps {
  onRefresh: () => void;
  /** True while data is being re-fetched; the icon spins and the button is disabled. */
  refreshing: boolean;
}

export function RefreshButton({ onRefresh, refreshing }: RefreshButtonProps) {
  return (
    <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing} aria-label="Refresh">
      <RefreshCwIcon className={refreshing ? "animate-spin" : undefined} />
      Refresh
    </Button>
  );
}
