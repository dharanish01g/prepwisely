import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { buildCategoryRows, type Category, type CategoryInput, slugify } from "@/lib/categories";

const NO_PARENT = "none";

interface CategoryFieldsProps {
  form: CategoryInput;
  onChange: (patch: Partial<CategoryInput>) => void;
  categories: Category[];
  /** Categories that can't be chosen as parent (the category itself and its descendants). */
  excludedParentIds?: Set<string>;
  /** Keep the slug in sync with the name until the slug is edited by hand. */
  autoSlug: boolean;
  idPrefix: string;
}

/** Form fields shared by the add and edit category dialogs. */
export function CategoryFields({ form, onChange, categories, excludedParentIds, autoSlug, idPrefix }: CategoryFieldsProps) {
  const [slugTouched, setSlugTouched] = useState(!autoSlug);

  const parentOptions = useMemo(
    () => buildCategoryRows(categories).filter((r) => !excludedParentIds?.has(r.category.id)),
    [categories, excludedParentIds],
  );
  const items = [
    { value: NO_PARENT, label: "None (top level)" },
    ...parentOptions.map((r) => ({ value: r.category.id, label: r.path })),
  ];

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}name`}>Name</Label>
        <Input
          id={`${idPrefix}name`}
          required
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value, ...(slugTouched ? {} : { slug: slugify(e.target.value) }) })}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}slug`}>Slug</Label>
        <Input
          id={`${idPrefix}slug`}
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          title="Lowercase letters, numbers and hyphens"
          value={form.slug}
          onChange={(e) => {
            setSlugTouched(true);
            onChange({ slug: e.target.value });
          }}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}parent`}>Parent category</Label>
        <Select
          value={form.parent_id ?? NO_PARENT}
          onValueChange={(v) => onChange({ parent_id: v === NO_PARENT ? null : v })}
          items={items}
        >
          <SelectTrigger id={`${idPrefix}parent`} className="w-full">
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
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}description`}>Description</Label>
        <Textarea
          id={`${idPrefix}description`}
          rows={2}
          value={form.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor={`${idPrefix}active`}>Active</Label>
        <Switch id={`${idPrefix}active`} checked={form.is_active} onCheckedChange={(is_active) => onChange({ is_active })} />
      </div>
    </div>
  );
}
