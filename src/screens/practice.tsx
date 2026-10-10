import { type ChangeEvent, type FormEvent, useMemo, useRef, useState } from "react";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  FolderIcon,
  ImageUpIcon,
  PencilIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { IconPicker, LucideIcon } from "@/components/icon-picker";
import { Markdown, MarkdownField } from "@/components/markdown";
import { RefreshButton } from "@/components/refresh-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSetBreadcrumbTrail } from "@/hooks/use-breadcrumb";
import {
  type CategoryInput,
  IMAGE_TYPES,
  type PcCategory,
  type PcDomain,
  slugify,
  uploadCategoryImage,
  useCreateCategory,
  useCreateDomain,
  usePractice,
  useReorderCategories,
  useReorderDomains,
  useSetCategoryArchived,
  useSetDomainArchived,
  useUpdateCategory,
  useUpdateDomain,
} from "@/lib/practice";

// PrepCode Practice (superadmin and content managers): the domains on PrepCode's Practice screen and the category
// cards under each (PRACTICE.md §4). Domains are added and renamed in a dialog; a category opens its own page (a
// drill-down) for the card's icon or image, details and a preview. Up / down sets the order PrepCode shows.
// Archiving hides a domain (with its categories) or a category from PrepCode.

/** Which page is open: the list, or a category's form (null id = a new category in that domain). */
type Editing = { categoryId: string | null; domainId: string } | null;

/** The ids with `id` swapped with its nearest visible neighbour in the direction `by`, or null at the end. */
function moved<T extends { id: string }>(all: T[], visible: Set<string>, id: string, by: -1 | 1): string[] | null {
  const ids = all.map((x) => x.id);
  const from = ids.indexOf(id);
  let to = from + by;
  while (to >= 0 && to < ids.length && !visible.has(ids[to])) to += by;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  return ids;
}

export function PracticeScreen() {
  const practice = usePractice();
  const [showArchived, setShowArchived] = useState(false);
  const [domainDialog, setDomainDialog] = useState<{ domain: PcDomain | null } | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const reorderDomains = useReorderDomains();

  const domains = practice.data?.domains ?? [];
  const categories = practice.data?.categories ?? [];
  const editingCategory = editing?.categoryId ? categories.find((c) => c.id === editing.categoryId) : undefined;

  useSetBreadcrumbTrail(
    editing
      ? {
          items: editingCategory ? [{ label: editingCategory.title }, { label: "Edit" }] : [{ label: "New category" }],
          onRoot: () => setEditing(null),
        }
      : null,
    editing ? (editingCategory ? `${editingCategory.id}/${editingCategory.title}/edit` : `new/${editing.domainId}`) : "",
  );

  const visibleDomains = useMemo(() => domains.filter((d) => showArchived || !d.archived_at), [domains, showArchived]);
  const visibleDomainIds = useMemo(() => new Set(visibleDomains.map((d) => d.id)), [visibleDomains]);

  if (editing && (editing.categoryId === null || editingCategory)) {
    return (
      <CategoryFormPage
        key={editing.categoryId ?? `new/${editing.domainId}`}
        category={editingCategory ?? null}
        defaultDomainId={editing.domainId}
        domains={domains}
        onDone={() => setEditing(null)}
      />
    );
  }

  function moveDomain(id: string, by: -1 | 1) {
    const ids = moved(domains, visibleDomainIds, id, by);
    if (ids) reorderDomains.mutate(ids, { onError: (err) => toast.error(err.message) });
  }

  const archivedCount = domains.filter((d) => d.archived_at).length;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Practice</h1>
          <p className="text-sm text-muted-foreground">
            The domains and category cards students see on PrepCode's Practice screen, in this order.
          </p>
        </div>
        <div className="flex gap-2">
          <RefreshButton onRefresh={() => void practice.refetch()} refreshing={practice.isFetching} />
          <Button size="sm" onClick={() => setDomainDialog({ domain: null })}>
            <PlusIcon />
            New domain
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Switch id="practice_show_archived" checked={showArchived} onCheckedChange={setShowArchived} />
        <Label htmlFor="practice_show_archived" className="font-normal">
          Show archived
        </Label>
      </div>

      {practice.isPending ? (
        <div className="grid gap-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : practice.error ? (
        <p className="border p-6 text-center text-sm text-destructive">Could not load Practice: {practice.error.message}</p>
      ) : visibleDomains.length === 0 ? (
        <p className="border p-6 text-center text-sm text-muted-foreground">
          {archivedCount > 0
            ? "All domains are archived. Turn on Show archived to see them."
            : "No domains yet. Add one (for example Aptitude or Technical) to get started."}
        </p>
      ) : (
        visibleDomains.map((domain, index) => (
          <DomainBlock
            key={domain.id}
            domain={domain}
            categories={categories.filter((c) => c.domain_id === domain.id)}
            showArchived={showArchived}
            first={index === 0}
            last={index === visibleDomains.length - 1}
            reordering={reorderDomains.isPending}
            onMove={(by) => moveDomain(domain.id, by)}
            onRename={() => setDomainDialog({ domain })}
            onAddCategory={() => setEditing({ categoryId: null, domainId: domain.id })}
            onEditCategory={(c) => setEditing({ categoryId: c.id, domainId: c.domain_id })}
          />
        ))
      )}

      <DomainDialog state={domainDialog} onClose={() => setDomainDialog(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// A domain and its categories
// ---------------------------------------------------------------------------------------------------------------

function StatusBadge({ archived }: { archived: boolean }) {
  return <Badge variant={archived ? "secondary" : "default"}>{archived ? "archived" : "active"}</Badge>;
}

function MoveButtons({
  label,
  first,
  last,
  disabled,
  onMove,
}: {
  label: string;
  first: boolean;
  last: boolean;
  disabled: boolean;
  onMove: (by: -1 | 1) => void;
}) {
  return (
    <>
      <Button variant="ghost" size="icon-sm" title="Move up" aria-label={`Move ${label} up`} disabled={disabled || first} onClick={() => onMove(-1)}>
        <ArrowUpIcon />
      </Button>
      <Button variant="ghost" size="icon-sm" title="Move down" aria-label={`Move ${label} down`} disabled={disabled || last} onClick={() => onMove(1)}>
        <ArrowDownIcon />
      </Button>
    </>
  );
}

function ArchiveButton({ label, archived, pending, onToggle }: { label: string; archived: boolean; pending: boolean; onToggle: () => void }) {
  const action = archived ? "Restore" : "Archive";
  return (
    <Button variant="ghost" size="icon-sm" title={action} aria-label={`${action} ${label}`} disabled={pending} onClick={onToggle}>
      {archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
    </Button>
  );
}

/** The card's picture as PrepCode draws it: the image, else the icon, else a folder. */
function CardImage({ icon, logoUrl, className }: { icon: string | null; logoUrl: string | null; className?: string }) {
  if (logoUrl) return <img src={logoUrl} alt="" className={`${className ?? "size-6"} object-contain`} />;
  if (icon) return <LucideIcon name={icon} className={className ?? "size-6"} />;
  return <FolderIcon className={className ?? "size-6"} />;
}

function DomainBlock({
  domain,
  categories,
  showArchived,
  first,
  last,
  reordering,
  onMove,
  onRename,
  onAddCategory,
  onEditCategory,
}: {
  domain: PcDomain;
  categories: PcCategory[];
  showArchived: boolean;
  first: boolean;
  last: boolean;
  reordering: boolean;
  onMove: (by: -1 | 1) => void;
  onRename: () => void;
  onAddCategory: () => void;
  onEditCategory: (category: PcCategory) => void;
}) {
  const setDomainArchived = useSetDomainArchived();
  const setCategoryArchived = useSetCategoryArchived();
  const reorderCategories = useReorderCategories();
  const archived = domain.archived_at !== null;

  const visible = categories.filter((c) => showArchived || !c.archived_at);
  const visibleIds = new Set(visible.map((c) => c.id));
  const hiddenCount = categories.length - visible.length;

  function toggleDomain() {
    setDomainArchived.mutate(
      { id: domain.id, archived: !archived },
      {
        onSuccess: () => toast.success(archived ? `Restored ${domain.title}.` : `Archived ${domain.title}. It's hidden from PrepCode.`),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function toggleCategory(category: PcCategory) {
    const was = category.archived_at !== null;
    setCategoryArchived.mutate(
      { id: category.id, archived: !was },
      {
        onSuccess: () => toast.success(was ? `Restored ${category.title}.` : `Archived ${category.title}. It's hidden from PrepCode.`),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function moveCategory(id: string, by: -1 | 1) {
    const ids = moved(categories, visibleIds, id, by);
    if (ids) reorderCategories.mutate({ domainId: domain.id, ids }, { onError: (err) => toast.error(err.message) });
  }

  return (
    <section className="border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-base font-semibold">{domain.title}</h2>
          <span className="text-xs text-muted-foreground">{domain.slug}</span>
          <StatusBadge archived={archived} />
        </div>
        <div className="flex items-center gap-1">
          <MoveButtons label={domain.title} first={first} last={last} disabled={reordering} onMove={onMove} />
          <Button
            variant="ghost"
            size="icon-sm"
            title={archived ? "Restore it to rename" : "Rename"}
            aria-label={`Rename ${domain.title}`}
            disabled={archived}
            onClick={onRename}
          >
            <PencilIcon />
          </Button>
          <ArchiveButton label={domain.title} archived={archived} pending={setDomainArchived.isPending} onToggle={toggleDomain} />
          <Button variant="outline" size="sm" disabled={archived} onClick={onAddCategory}>
            <PlusIcon />
            Category
          </Button>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12" />
            <TableHead>Title</TableHead>
            <TableHead>Slug</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="w-24">Status</TableHead>
            <TableHead className="w-36" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="h-16 text-center text-muted-foreground">
                {hiddenCount > 0 ? "All its categories are archived." : "No categories yet."}
              </TableCell>
            </TableRow>
          ) : (
            visible.map((c, index) => {
              const catArchived = c.archived_at !== null;
              return (
                <TableRow key={c.id}>
                  <TableCell>
                    <CardImage icon={c.icon} logoUrl={c.logo_url} className="size-5" />
                  </TableCell>
                  <TableCell className="max-w-48 truncate font-medium">{c.title}</TableCell>
                  <TableCell className="text-muted-foreground">{c.slug}</TableCell>
                  <TableCell className="max-w-96 truncate text-muted-foreground">{c.description}</TableCell>
                  <TableCell>
                    <StatusBadge archived={catArchived} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <MoveButtons
                        label={c.title}
                        first={index === 0}
                        last={index === visible.length - 1}
                        disabled={reorderCategories.isPending}
                        onMove={(by) => moveCategory(c.id, by)}
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title={catArchived ? "Restore it to edit" : "Edit"}
                        aria-label={`Edit ${c.title}`}
                        disabled={catArchived}
                        onClick={() => onEditCategory(c)}
                      >
                        <PencilIcon />
                      </Button>
                      <ArchiveButton label={c.title} archived={catArchived} pending={setCategoryArchived.isPending} onToggle={() => toggleCategory(c)} />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      {archived && (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          Archived: this domain and all its categories are hidden from PrepCode. Restore it to edit.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// New / rename domain
// ---------------------------------------------------------------------------------------------------------------

function DomainDialog({ state, onClose }: { state: { domain: PcDomain | null } | null; onClose: () => void }) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>{state && <DomainForm key={state.domain?.id ?? "new"} domain={state.domain} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function DomainForm({ domain, onClose }: { domain: PcDomain | null; onClose: () => void }) {
  const create = useCreateDomain();
  const update = useUpdateDomain();
  const busy = create.isPending || update.isPending;
  const [title, setTitle] = useState(domain?.title ?? "");
  const [slug, setSlug] = useState(domain?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (domain) {
        await update.mutateAsync({ id: domain.id, title });
        toast.success(`Renamed to ${title.trim()}.`);
      } else {
        await create.mutateAsync({ slug, title });
        toast.success(`Added ${title.trim()}.`);
      }
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{domain ? "Rename domain" : "New domain"}</DialogTitle>
        <DialogDescription>
          {domain ? "The slug stays the same." : "A heading on PrepCode's Practice screen, added at the end. Its slug can't be changed later."}
        </DialogDescription>
      </DialogHeader>

      <fieldset disabled={busy} className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="pc_domain_title">Title</Label>
          <Input
            id="pc_domain_title"
            placeholder="e.g. Aptitude"
            maxLength={60}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (!domain && !slugEdited) setSlug(slugify(e.target.value));
            }}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pc_domain_slug">Slug</Label>
          <Input
            id="pc_domain_slug"
            placeholder="e.g. aptitude"
            maxLength={64}
            value={slug}
            disabled={domain !== null}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugEdited(true);
            }}
          />
        </div>
      </fieldset>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <DialogFooter>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : domain ? "Save" : "Add domain"}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// A category's page: create or edit
// ---------------------------------------------------------------------------------------------------------------

type ImageMode = "icon" | "image";

function CategoryFormPage({
  category,
  defaultDomainId,
  domains,
  onDone,
}: {
  category: PcCategory | null;
  defaultDomainId: string;
  domains: PcDomain[];
  onDone: () => void;
}) {
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const [uploading, setUploading] = useState(false);
  const busy = create.isPending || update.isPending || uploading;

  const [form, setForm] = useState<CategoryInput>({
    domain_id: category?.domain_id ?? defaultDomainId,
    slug: category?.slug ?? "",
    title: category?.title ?? "",
    description: category?.description ?? "",
    icon: category?.icon ?? null,
    logo_url: category?.logo_url ?? null,
    details: category?.details ?? "",
  });
  const [slugEdited, setSlugEdited] = useState(false);
  const [mode, setMode] = useState<ImageMode>(category?.logo_url ? "image" : "icon");
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<CategoryInput>) => setForm((f) => ({ ...f, ...patch }));
  // Archived domains can't take categories; the category's current domain always stays listed.
  const domainItems = domains
    .filter((d) => !d.archived_at || d.id === form.domain_id)
    .map((d) => ({ value: d.id, label: d.archived_at ? `${d.title} (archived)` : d.title }));

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const url = await uploadCategoryImage(file);
      set({ logo_url: url, icon: null });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Only the chosen kind is saved: an icon or an image, never both.
    const input = mode === "icon" ? { ...form, logo_url: null } : { ...form, icon: null };
    try {
      if (category) {
        await update.mutateAsync({ id: category.id, input });
        toast.success(`Saved ${form.title.trim()}.`);
      } else {
        await create.mutateAsync(input);
        toast.success(`Added ${form.title.trim()}.`);
      }
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-1 flex-col gap-5 p-4 pt-0">
      <div>
        <h1 className="text-2xl font-semibold">{category ? "Edit category" : "New category"}</h1>
        <p className="text-sm text-muted-foreground">A card on PrepCode's Practice screen. Its questions are added later.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <fieldset disabled={busy} className="grid max-w-2xl content-start gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="pc_category_domain">Domain</Label>
            <Select value={form.domain_id} onValueChange={(v) => v && set({ domain_id: v })} items={domainItems}>
              <SelectTrigger id="pc_category_domain" className="w-72">
                <SelectValue placeholder="Choose a domain" />
              </SelectTrigger>
              <SelectContent>
                {domainItems.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {category && form.domain_id !== category.domain_id && (
              <p className="text-xs text-muted-foreground">Moving it puts it last in the new domain.</p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="pc_category_title">Title</Label>
              <Input
                id="pc_category_title"
                placeholder="e.g. Programming Basics"
                maxLength={60}
                value={form.title}
                onChange={(e) => set(category || slugEdited ? { title: e.target.value } : { title: e.target.value, slug: slugify(e.target.value) })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pc_category_slug">Slug</Label>
              <Input
                id="pc_category_slug"
                placeholder="e.g. basics"
                maxLength={64}
                value={form.slug}
                disabled={category !== null}
                onChange={(e) => {
                  set({ slug: e.target.value });
                  setSlugEdited(true);
                }}
              />
              <p className="text-xs text-muted-foreground">
                {category ? "Can't be changed." : "Unique across all categories. Can't be changed later."}
              </p>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="pc_category_description">Description</Label>
            <Input
              id="pc_category_description"
              placeholder="One sentence on the card, e.g. Patterns, number programs and loops."
              maxLength={200}
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Card image</Label>
              <div className="flex gap-1">
                <Button type="button" size="xs" variant={mode === "icon" ? "secondary" : "ghost"} onClick={() => setMode("icon")}>
                  Icon
                </Button>
                <Button type="button" size="xs" variant={mode === "image" ? "secondary" : "ghost"} onClick={() => setMode("image")}>
                  Image
                </Button>
              </div>
            </div>
            {mode === "icon" ? (
              <IconPicker value={form.icon} onChange={(icon) => set({ icon })} disabled={busy} />
            ) : (
              <div className="flex flex-wrap items-center gap-3 border p-3">
                {form.logo_url ? (
                  <img src={form.logo_url} alt="Card image" className="size-12 border object-contain" />
                ) : (
                  <div className="flex size-12 items-center justify-center border text-muted-foreground">
                    <ImageUpIcon className="size-5" />
                  </div>
                )}
                <input ref={fileInput} type="file" accept={IMAGE_TYPES.join(",")} className="hidden" onChange={handleFile} />
                <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                  {uploading ? "Uploading…" : form.logo_url ? "Replace image" : "Upload image"}
                </Button>
                {form.logo_url && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => set({ logo_url: null })}>
                    <XIcon />
                    Remove
                  </Button>
                )}
                <p className="w-full text-xs text-muted-foreground">PNG, JPG or WebP, up to 200 KB. Square images look best.</p>
              </div>
            )}
          </div>

          <MarkdownField
            id="pc_category_details"
            label="Details (optional)"
            rows={6}
            value={form.details}
            onChange={(details) => set({ details })}
            placeholder="Markdown shown above the questions, e.g. a company's exam pattern and eligibility."
            disabled={busy}
          />
        </fieldset>

        <div className="grid content-start gap-2">
          <p className="text-sm font-medium">Preview</p>
          <CardPreview form={form} mode={mode} />
          <p className="text-xs text-muted-foreground">Roughly how the card looks in PrepCode.</p>
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-2 pb-4">
        <Button type="submit" disabled={busy}>
          {create.isPending || update.isPending ? "Saving…" : category ? "Save changes" : "Add category"}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** The card as PrepCode shows it, with the details students see when they open it. */
function CardPreview({ form, mode }: { form: CategoryInput; mode: ImageMode }) {
  return (
    <div className="grid gap-3">
      <div className="flex min-h-44 flex-col border bg-card">
        <div className="flex flex-1 flex-col gap-2 p-4">
          <CardImage icon={mode === "icon" ? form.icon : null} logoUrl={mode === "image" ? form.logo_url : null} className="size-7" />
          <p className="font-semibold">{form.title.trim() || "Title"}</p>
          <p className="text-sm text-muted-foreground">{form.description.trim() || "Description"}</p>
        </div>
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">No questions yet</p>
      </div>
      {form.details.trim() && (
        <div className="border p-3">
          <Markdown>{form.details}</Markdown>
        </div>
      )}
    </div>
  );
}
