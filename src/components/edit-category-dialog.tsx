import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { type Category, useSaveCategory } from "@/lib/categories";

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
  const [name, setName] = useState(category.name);
  const [description, setDescription] = useState(category.description ?? "");
  const save = useSaveCategory();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate({ id: category.id, name, description }, { onSuccess: onClose });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Edit category</DialogTitle>
        <DialogDescription>Update details for {category.name}.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="edit_name">Name</Label>
          <Input id="edit_name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="edit_description">Description</Label>
          <Textarea id="edit_description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      {save.error && <p className="text-xs text-destructive">{save.error.message}</p>}

      <DialogFooter>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}
