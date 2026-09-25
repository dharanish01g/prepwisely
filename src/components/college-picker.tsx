import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import type { College } from "@/lib/colleges";

const label = (c: College) => `${c.code} · ${c.name}`;

interface CollegePickerProps {
  colleges: College[];
  value: string | null;
  onChange: (collegeId: string) => void;
  className?: string;
}

/** Type-to-search college picker: matches code, name or city (e.g. "kec", "kongu" or "erode"). */
export function CollegePicker({ colleges, value, onChange, className = "w-80" }: CollegePickerProps) {
  const selected = colleges.find((c) => c.id === value) ?? null;

  return (
    <Combobox
      items={colleges}
      value={selected}
      onValueChange={(c: College | null) => {
        if (c) onChange(c.id);
      }}
      itemToStringLabel={label}
      isItemEqualToValue={(a: College, b: College) => a.id === b.id}
      filter={(c: College, query: string) => {
        const q = query.trim().toLowerCase();
        // The input shows the selected college's label; treat that as "no search" so the full list opens.
        if (!q || (selected && q === label(selected).toLowerCase())) return true;
        return [c.code, c.name, c.city ?? ""].some((v) => v.toLowerCase().includes(q));
      }}
    >
      <ComboboxInput placeholder="Select college" aria-label="College" className={className} />
      <ComboboxContent>
        <ComboboxEmpty>No colleges match.</ComboboxEmpty>
        <ComboboxList>
          {(c: College) => (
            <ComboboxItem key={c.id} value={c}>
              <span className="w-14 shrink-0 font-medium">{c.code}</span>
              <span className="truncate">{c.name}</span>
              {c.city && <span className="ml-auto shrink-0 text-muted-foreground">{c.city}</span>}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
