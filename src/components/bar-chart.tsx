import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface Bar {
  key: string;
  value: number;
  /** Shown on hover, e.g. "Tue 14 Oct: 5 sign-ups". */
  tooltip: string;
}

/**
 * One series of bars over time, with the largest value marked at the top and labels under the first, middle and
 * last bar. Hovering a bar shows its tooltip.
 */
export function BarChart({ bars, labels }: { bars: Bar[]; labels: [string, string, string] }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="flex flex-col gap-1">
      <div className="relative flex h-44 items-end gap-px border-b border-t border-t-border/50">
        <span className="absolute -top-2 right-0 bg-background pl-1 text-[10px] leading-none text-muted-foreground tabular-nums">
          {max}
        </span>
        {bars.map((b) => (
          <Tooltip key={b.key}>
            <TooltipTrigger render={<div className="flex h-full min-w-0 flex-1 items-end hover:bg-muted" aria-label={b.tooltip} />}>
              <div className="w-full bg-primary" style={{ height: `${(b.value / max) * 100}%` }} />
            </TooltipTrigger>
            <TooltipContent>{b.tooltip}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        {labels.map((label, i) => (
          <span key={i}>{label}</span>
        ))}
      </div>
    </div>
  );
}
