import { useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";
import { DynamicIcon, type IconName, iconNames } from "lucide-react/dynamic";
import { cn } from "cn";
import { Input } from "@/components/ui/input";

// Every Lucide icon, searchable by name. Each icon loads on demand, so only the matches on screen are fetched.
const SHOWN = 96;
const NAMES = new Set<string>(iconNames);

export function isIconName(name: string): name is IconName {
  return NAMES.has(name);
}

/** A Lucide icon by name; nothing for a name Lucide doesn't have. */
export function LucideIcon({ name, className }: { name: string; className?: string }) {
  return isIconName(name) ? <DynamicIcon name={name} className={className} /> : null;
}

interface IconPickerProps {
  value: string | null;
  onChange: (name: string) => void;
  disabled?: boolean;
}

export function IconPicker({ value, onChange, disabled }: IconPickerProps) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, "-");
    return q ? iconNames.filter((n) => n.includes(q)) : iconNames;
  }, [query]);

  return (
    <div className="grid gap-2">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={`Search ${iconNames.length} icons, e.g. calculator, code, book`}
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8"
          aria-label="Search icons"
        />
      </div>
      <div className="grid max-h-64 grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1 overflow-y-auto border p-1">
        {matches.slice(0, SHOWN).map((name) => (
          <button
            key={name}
            type="button"
            title={name}
            aria-label={name}
            aria-pressed={value === name}
            disabled={disabled}
            onClick={() => onChange(name)}
            className={cn(
              "flex aspect-square items-center justify-center border border-transparent hover:bg-muted disabled:opacity-50",
              value === name && "border-primary bg-muted",
            )}
          >
            <DynamicIcon name={name} className="size-5" />
          </button>
        ))}
        {matches.length === 0 && <p className="col-span-full p-3 text-center text-xs text-muted-foreground">No icon matches.</p>}
      </div>
      <p className="text-xs text-muted-foreground">
        {matches.length > SHOWN ? `Showing ${SHOWN} of ${matches.length}. Search to narrow down.` : `${matches.length} shown.`}
        {value && ` Selected: ${value}`}
      </p>
    </div>
  );
}
