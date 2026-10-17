import { ArchiveIcon, ArchiveRestoreIcon, ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// Row controls shared by the ordered, archivable lists (Practice domains and categories, Question kinds).

/** The ids with `id` swapped with its nearest visible neighbour in the direction `by`, or null at the end. */
export function moved<T extends { id: string }>(all: T[], visible: Set<string>, id: string, by: -1 | 1): string[] | null {
  const ids = all.map((x) => x.id);
  const from = ids.indexOf(id);
  let to = from + by;
  while (to >= 0 && to < ids.length && !visible.has(ids[to])) to += by;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  return ids;
}

export function StatusBadge({ archived }: { archived: boolean }) {
  return <Badge variant={archived ? "secondary" : "default"}>{archived ? "archived" : "active"}</Badge>;
}

export function MoveButtons({
  label,
  first,
  last,
  disabled,
  onMove,
}: {
  label: string;
  first: boolean;
  last: boolean;
  disabled: boolean;
  onMove: (by: -1 | 1) => void;
}) {
  return (
    <>
      <Button variant="ghost" size="icon-sm" title="Move up" aria-label={`Move ${label} up`} disabled={disabled || first} onClick={() => onMove(-1)}>
        <ArrowUpIcon />
      </Button>
      <Button variant="ghost" size="icon-sm" title="Move down" aria-label={`Move ${label} down`} disabled={disabled || last} onClick={() => onMove(1)}>
        <ArrowDownIcon />
      </Button>
    </>
  );
}

export function ArchiveButton({ label, archived, pending, onToggle }: { label: string; archived: boolean; pending: boolean; onToggle: () => void }) {
  const action = archived ? "Restore" : "Archive";
  return (
    <Button variant="ghost" size="icon-sm" title={action} aria-label={`${action} ${label}`} disabled={pending} onClick={onToggle}>
      {archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
    </Button>
  );
}
