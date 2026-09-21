import { type FormEvent, useMemo, useState } from "react";
import { toast } from "sonner";
import { MarkdownField } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildCategoryRows, useCategories } from "@/lib/categories";
import { type BriefRow, useContentTeam, useSaveBrief } from "@/lib/briefs";

interface BriefDialogProps {
  /** null = closed; { brief: null } = new brief; { brief } = editing. */
  state: { brief: BriefRow | null } | null;
  onClose: () => void;
}

export function BriefDialog({ state, onClose }: BriefDialogProps) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        {/* Keyed so the form starts fresh for each brief (or for a new one). */}
        {state && <BriefForm key={state.brief?.id ?? "new"} brief={state.brief} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function BriefForm({ brief, onClose }: { brief: BriefRow | null; onClose: () => void }) {
  const [title, setTitle] = useState(brief?.title ?? "");
  const [description, setDescription] = useState(brief?.description ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(brief?.category_id ?? null);
  const [easy, setEasy] = useState(String(brief?.target_easy ?? 0));
  const [medium, setMedium] = useState(String(brief?.target_medium ?? 0));
  const [hard, setHard] = useState(String(brief?.target_hard ?? 0));
  const [deadline, setDeadline] = useState(brief?.deadline ?? "");
  const [creatorIds, setCreatorIds] = useState<string[]>(brief?.creator_ids ?? []);
  const [problem, setProblem] = useState<string | null>(null);

  const { data: categories = [] } = useCategories();
  const { data: team = [] } = useContentTeam();
  const save = useSaveBrief();

  const categoryItems = useMemo(
    () =>
      buildCategoryRows(categories)
        .filter((r) => r.category.is_active || r.category.id === categoryId)
        .map((r) => ({ value: r.category.id, label: r.path })),
    [categories, categoryId],
  );
  // Active creators, plus anyone already assigned even if they've since been deactivated.
  const creators = team.filter((m) => m.roles.includes("content_creator") && (m.status === "active" || creatorIds.includes(m.id)));

  const toggle = (id: string) => setCreatorIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    save.mutate(
      {
        id: brief?.id,
        currentCreatorIds: brief?.creator_ids ?? [],
        input: {
          title,
          description,
          category_id: categoryId,
          target_easy: Number(easy || 0),
          target_medium: Number(medium || 0),
          target_hard: Number(hard || 0),
          deadline,
          creator_ids: creatorIds,
        },
      },
      {
        onSuccess: () => {
          toast.success(brief ? "Brief updated." : "Brief created.");
          onClose();
        },
        onError: (err) => setProblem(err.message),
      },
    );
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex max-h-[80vh] flex-col gap-4 overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{brief ? "Edit brief" : "New brief"}</DialogTitle>
        <DialogDescription>Tell creators what to write: a topic, how many of each difficulty, and by when.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="brief_title">Title</Label>
          <Input id="brief_title" placeholder="e.g. Core Java, first batch" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="brief_category">Topic</Label>
          <Select value={categoryId} onValueChange={setCategoryId} items={categoryItems}>
            <SelectTrigger id="brief_category" className="w-full">
              <SelectValue placeholder="Select a category" />
            </SelectTrigger>
            <SelectContent>
              {categoryItems.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Questions in this category or any of its subcategories count towards the brief.</p>
        </div>

        <div className="grid gap-1.5">
          <Label>Target (approved questions)</Label>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["Easy", easy, setEasy],
                ["Medium", medium, setMedium],
                ["Hard", hard, setHard],
              ] as const
            ).map(([label, value, set]) => (
              <div key={label} className="grid gap-1">
                <span className="text-xs text-muted-foreground">{label}</span>
                <Input type="number" inputMode="numeric" min={0} step={1} aria-label={`${label} target`} value={value} onChange={(e) => set(e.target.value)} />
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="brief_deadline">Deadline (optional)</Label>
          <Input id="brief_deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="w-44" />
        </div>

        <MarkdownField
          id="brief_description"
          label="Instructions (optional)"
          rows={3}
          placeholder="Anything creators should know: scope, style, sources to avoid. Markdown is supported."
          value={description}
          onChange={setDescription}
        />

        <div className="grid gap-1.5">
          <Label>Assigned creators</Label>
          {creators.length === 0 ? (
            <p className="text-xs text-muted-foreground">There are no content creators yet. Add some in User Management.</p>
          ) : (
            <div className="grid max-h-36 gap-1 overflow-y-auto border p-2">
              {creators.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" className="accent-primary" checked={creatorIds.includes(m.id)} onChange={() => toggle(m.id)} />
                  <span className="font-medium">{m.full_name}</span>
                  <span className="text-muted-foreground">{m.email}</span>
                  {m.status === "inactive" && <span className="text-destructive">inactive</span>}
                </label>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">They share the target. You can assign more people later.</p>
        </div>
      </div>

      {problem && <p className="text-xs text-destructive">{problem}</p>}

      <DialogFooter>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : brief ? "Save changes" : "Create brief"}
        </Button>
      </DialogFooter>
    </form>
  );
}
