import { type FormEvent, useMemo, useState } from "react";
import { PencilIcon, PlusIcon, ShapesIcon } from "lucide-react";
import { IconPicker, LucideIcon } from "@/components/icon-picker";
import { toast } from "sonner";
import { ArchiveButton, MoveButtons, moved, StatusBadge } from "@/components/list-controls";
import { RefreshButton } from "@/components/refresh-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  type KindInput,
  type QuestionKind,
  slugify,
  useCreateQuestionKind,
  usePractice,
  useQuestionKinds,
  useReorderQuestionKinds,
  useSetQuestionKindArchived,
  useUpdateQuestionKind,
} from "@/lib/practice";

// Question kinds (superadmin and content managers): the kinds a Practice category can hold (MCQ, Coding, ...), laid out
// and controlled like the Practice page, with the same fields as a card: title, slug, description and icon. A kind is added here, but questions of a new kind can't be written until
// prepwisely has an editor for it. Nothing is deleted: archiving a kind stops categories from newly picking it, while
// categories that already use it keep it.

export function QuestionKindsScreen() {
  const kinds = useQuestionKinds();
  const practice = usePractice();
  const setArchived = useSetQuestionKindArchived();
  const reorder = useReorderQuestionKinds();
  const [showArchived, setShowArchived] = useState(false);
  const [dialog, setDialog] = useState<{ kind: QuestionKind | null } | null>(null);

  const all = useMemo(() => kinds.data ?? [], [kinds.data]);
  const visible = useMemo(() => all.filter((k) => showArchived || !k.archived_at), [all, showArchived]);
  const visibleIds = useMemo(() => new Set(visible.map((k) => k.id)), [visible]);
  const archivedCount = all.length - all.filter((k) => !k.archived_at).length;
  const categories = practice.data?.categories ?? [];
  const usedBy = (id: string) => categories.filter((c) => c.question_kind === id).length;

  function toggle(kind: QuestionKind) {
    const was = kind.archived_at !== null;
    setArchived.mutate(
      { id: kind.id, archived: !was },
      {
        onSuccess: () => toast.success(was ? `Restored ${kind.title}.` : `Archived ${kind.title}. New categories can't pick it.`),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function move(id: string, by: -1 | 1) {
    const ids = moved(all, visibleIds, id, by);
    if (ids) reorder.mutate(ids, { onError: (err) => toast.error(err.message) });
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Question kinds</h1>
          <p className="text-sm text-muted-foreground">The kinds of question a Practice category can hold, in this order. Each category picks one kind.</p>
        </div>
        <div className="flex gap-2">
          <RefreshButton
            onRefresh={() => {
              void kinds.refetch();
              void practice.refetch();
            }}
            refreshing={kinds.isFetching || practice.isFetching}
          />
          <Button size="sm" onClick={() => setDialog({ kind: null })}>
            <PlusIcon />
            New kind
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Switch id="question_kinds_show_archived" checked={showArchived} onCheckedChange={setShowArchived} />
        <Label htmlFor="question_kinds_show_archived" className="font-normal">
          Show archived
        </Label>
      </div>

      {kinds.isPending ? (
        <Skeleton className="h-40" />
      ) : kinds.error ? (
        <p className="border p-6 text-center text-sm text-destructive">Could not load question kinds: {kinds.error.message}</p>
      ) : visible.length === 0 ? (
        <p className="border p-6 text-center text-sm text-muted-foreground">
          {archivedCount > 0 ? "All kinds are archived. Turn on Show archived to see them." : "No kinds yet. Add one (for example MCQ) to get started."}
        </p>
      ) : (
        <section className="border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12" />
                <TableHead>Title</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-28">Categories</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-36" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((k, index) => {
                const archived = k.archived_at !== null;
                return (
                  <TableRow key={k.id}>
                    <TableCell>
                      <KindIcon icon={k.icon} className="size-5" />
                    </TableCell>
                    <TableCell className="max-w-48 truncate font-medium">{k.title}</TableCell>
                    <TableCell className="text-muted-foreground">{k.id}</TableCell>
                    <TableCell className="max-w-96 truncate text-muted-foreground">{k.description}</TableCell>
                    <TableCell className="text-muted-foreground">{practice.data ? usedBy(k.id) : "…"}</TableCell>
                    <TableCell>
                      <StatusBadge archived={archived} />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <MoveButtons
                          label={k.title}
                          first={index === 0}
                          last={index === visible.length - 1}
                          disabled={reorder.isPending}
                          onMove={(by) => move(k.id, by)}
                        />
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title={archived ? "Restore it to edit" : "Edit"}
                          aria-label={`Edit ${k.title}`}
                          disabled={archived}
                          onClick={() => setDialog({ kind: k })}
                        >
                          <PencilIcon />
                        </Button>
                        <ArchiveButton label={k.title} archived={archived} pending={setArchived.isPending} onToggle={() => toggle(k)} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            Archived: categories can't newly pick it; those already using it keep it. Questions of a kind can only be
            written once prepwisely has an editor for it; today that's Coding.
          </p>
        </section>
      )}

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="sm:max-w-xl">{dialog && <KindForm key={dialog.kind?.id ?? "new"} kind={dialog.kind} onClose={() => setDialog(null)} />}</DialogContent>
      </Dialog>
    </div>
  );
}

/** The kind's icon, else a generic shape. */
function KindIcon({ icon, className }: { icon: string | null; className?: string }) {
  return icon ? <LucideIcon name={icon} className={className} /> : <ShapesIcon className={className} />;
}

// ---------------------------------------------------------------------------------------------------------------
// New / edit kind
// ---------------------------------------------------------------------------------------------------------------

function KindForm({ kind, onClose }: { kind: QuestionKind | null; onClose: () => void }) {
  const create = useCreateQuestionKind();
  const update = useUpdateQuestionKind();
  const busy = create.isPending || update.isPending;
  const [form, setForm] = useState<KindInput>({
    id: kind?.id ?? "",
    title: kind?.title ?? "",
    description: kind?.description ?? "",
    icon: kind?.icon ?? null,
  });
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<KindInput>) => setForm((f) => ({ ...f, ...patch }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (kind) {
        await update.mutateAsync(form);
        toast.success(`Saved ${form.title.trim()}.`);
      } else {
        await create.mutateAsync(form);
        toast.success(`Added ${form.title.trim()}.`);
      }
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{kind ? "Edit kind" : "New kind"}</DialogTitle>
        <DialogDescription>{kind ? "The slug stays the same." : "Added at the end of the list. Its slug can't be changed later."}</DialogDescription>
      </DialogHeader>

      <fieldset disabled={busy} className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="question_kind_title">Title</Label>
            <Input
              id="question_kind_title"
              placeholder="e.g. Fill in the blank"
              maxLength={60}
              value={form.title}
              onChange={(e) => set(kind || slugEdited ? { title: e.target.value } : { title: e.target.value, id: slugify(e.target.value) })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="question_kind_slug">Slug</Label>
            <Input
              id="question_kind_slug"
              placeholder="e.g. fill-blank"
              maxLength={64}
              value={form.id}
              disabled={kind !== null}
              onChange={(e) => {
                set({ id: e.target.value });
                setSlugEdited(true);
              }}
            />
            <p className="text-xs text-muted-foreground">
              {kind ? "Can't be changed." : "PrepCode uses it to pick the screen. Can't be changed later."}
            </p>
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="question_kind_description">Description</Label>
          <Input
            id="question_kind_description"
            placeholder="One sentence, e.g. Pick the one correct answer from the options."
            maxLength={200}
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
          />
        </div>

        <div className="grid gap-1.5">
          <Label>Icon</Label>
          <IconPicker value={form.icon} onChange={(icon) => set({ icon })} disabled={busy} />
        </div>
      </fieldset>

      <div className="flex items-center gap-3 border p-3">
        <KindIcon icon={form.icon} className="size-6" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{form.title.trim() || "Title"}</p>
          <p className="truncate text-xs text-muted-foreground">{form.description.trim() || "Description"}</p>
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <DialogFooter>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : kind ? "Save" : "Add kind"}
        </Button>
      </DialogFooter>
    </form>
  );
}
