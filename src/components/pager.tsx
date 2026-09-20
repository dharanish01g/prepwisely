import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PagerProps {
  /** Zero-based. */
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  disabled?: boolean;
}

export function Pager({ page, pageSize, total, onPage, disabled }: PagerProps) {
  if (total === 0) return null;
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  const lastPage = Math.ceil(total / pageSize) - 1;

  return (
    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex gap-1">
        <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={disabled || page === 0} onClick={() => onPage(page - 1)}>
          <ChevronLeftIcon />
        </Button>
        <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={disabled || page >= lastPage} onClick={() => onPage(page + 1)}>
          <ChevronRightIcon />
        </Button>
      </div>
    </div>
  );
}
