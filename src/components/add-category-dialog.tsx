import { type FormEvent, useState } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CategoryFields } from "@/components/category-fields";
import { type CategoryInput, useCategories, useSaveCategory } from "@/lib/categories";

const EMPTY: CategoryInput = { name: "", slug: "", parent_id: null, description: "", is_active: true };

export function AddCategoryDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const save = useSaveCategory();
  const { data: categories = [] } = useCategories();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setForm(EMPTY);
      save.reset();
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate(form, { onSuccess: () => handleOpenChange(false) });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" />}>
        <PlusIcon />
        Add category
      </DialogTrigger>
      <DialogContent>
        <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Add category</DialogTitle>
            <DialogDescription>Create a category to organise the question bank.</DialogDescription>
          </DialogHeader>

          {/* Keyed on open so the slug auto-fill state resets each time the dialog is opened. */}
          <CategoryFields
            key={String(open)}
            form={form}
            onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
            categories={categories}
            autoSlug
            idPrefix="add_category_"
          />

          {save.error && <p className="text-xs text-destructive">{save.error.message}</p>}

          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Creating…" : "Create category"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
