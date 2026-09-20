import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface FilterSelectProps {
  value: string;
  onChange: (value: string) => void;
  items: { value: string; label: string }[];
  className?: string;
  "aria-label": string;
}

/** A compact dropdown for list filters ("All statuses", ...). */
export function FilterSelect({ value, onChange, items, className = "w-44", "aria-label": ariaLabel }: FilterSelectProps) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? items[0].value)} items={items}>
      <SelectTrigger className={className} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
