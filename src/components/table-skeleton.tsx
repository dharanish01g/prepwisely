import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";

interface TableSkeletonRowsProps {
  /** One Tailwind width class per column, e.g. ["w-32", "w-48", "w-6"]. */
  columns: string[];
  rows?: number;
}

/** Placeholder rows shown inside a TableBody while data loads. */
export function TableSkeletonRows({ columns, rows = 5 }: TableSkeletonRowsProps) {
  return Array.from({ length: rows }, (_, row) => (
    <TableRow key={row}>
      {columns.map((width, col) => (
        <TableCell key={col}>
          {row === 0 && col === 0 && <span className="sr-only">Loading…</span>}
          <Skeleton className={`h-4 ${width}`} />
        </TableCell>
      ))}
    </TableRow>
  ));
}
