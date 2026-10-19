import type { ReactNode } from "react";

// The boxes the Overview and Platform analytics pages are made of.

/** A headline number with a label above and a line of detail below. `value` may be text, e.g. "120 ms". */
export function StatTile({ label, value, detail }: { label: string; value: ReactNode; detail: string }) {
  return (
    <div className="flex flex-col gap-1 border p-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-3xl font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </div>
  );
}

export function Panel({ title, note, className, children }: { title: string; note?: string; className?: string; children: ReactNode }) {
  return (
    <div className={`flex flex-col gap-4 border p-4 ${className ?? ""}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </div>
      {children}
    </div>
  );
}
