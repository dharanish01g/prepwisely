import { type FormEvent, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CategoryFields } from "@/components/category-fields";
import { type Category, type CategoryInput, selfAndDescendantIds, useCategories, useSaveCategory } from "@/lib/categories";

interface EditCategoryDialogProps {
  category: Category | null;
  onClose: () => void;
}

export function EditCategoryDialog({ category, onClose }: EditCategoryDialogProps) {
  return (
    <Dialog open={category !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {/* Keyed by category so the form state resets when a different category is opened. */}
        {category && <EditCategoryForm key={category.id} category={category} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function EditCategoryForm({ category, onClose }: { category: Category; onClose: () => void }) {
  const [form, setForm] = useState<CategoryInput>({
    name: category.name,
    slug: category.slug,
    parent_id: category.parent_id,
    description: category.description ?? "",
    is_active: category.is_active,
  });
  const save = useSaveCategory();
  const { data: categories = [] } = useCategories();
  const excluded = useMemo(() => selfAndDescendantIds(categories, category.id), [categories, category.id]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate({ id: category.id, ...form }, { onSuccess: onClose });
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Edit category</DialogTitle>
        <DialogDescription>Update details for {category.name}.</DialogDescription>
      </DialogHeader>

      <CategoryFields
        form={form}
        onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
        categories={categories}
        excludedParentIds={excluded}
        autoSlug={false}
        idPrefix="edit_category_"
      />

      {save.error && <p className="text-xs text-destructive">{save.error.message}</p>}

      <DialogFooter>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}
