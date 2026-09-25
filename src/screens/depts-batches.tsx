import { useMemo, useState } from "react";
import { ArchiveIcon, ArchiveRestoreIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { BatchDialog } from "@/components/batch-dialog";
import { CollegePicker } from "@/components/college-picker";
import { DepartmentDialog } from "@/components/department-dialog";
import { RefreshButton } from "@/components/refresh-button";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSetBreadcrumbTrail } from "@/hooks/use-breadcrumb";
import { type College, useColleges } from "@/lib/colleges";
import { useIsSuperadmin } from "@/lib/roles";
import { type Batch, type Department, useBatches, useDepartments, useSetArchived } from "@/lib/structure";

// Depts & batches: the page lists a college's departments; clicking a row opens a drawer with the department's
// details (drawers are for details only), and "View batches" drills into a page listing that department's batches.
// The header breadcrumb shows the trail (Depts & batches › SEC › CSE); clicking back up keeps the picked college.

function StatusBadge({ archived }: { archived: boolean }) {
  return <Badge variant={archived ? "secondary" : "default"}>{archived ? "archived" : "active"}</Badge>;
}

function ShowArchivedSwitch({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Switch id="show_archived" checked={checked} onCheckedChange={onChange} />
      <Label htmlFor="show_archived" className="font-normal">
        Show archived
      </Label>
    </div>
  );
}

/** Type-to-filter graduation year picker; empty means every year. */
function YearFilter({ years, value, onChange }: { years: number[]; value: number | null; onChange: (year: number | null) => void }) {
  const items = years.map(String);
  return (
    <Combobox items={items} value={value === null ? null : String(value)} onValueChange={(v: string | null) => onChange(v ? Number(v) : null)}>
      <ComboboxInput placeholder="All years" aria-label="Graduation year" className="w-40" showClear />
      <ComboboxContent>
        <ComboboxEmpty>No batches graduate that year.</ComboboxEmpty>
        <ComboboxList>
          {(year: string) => (
            <ComboboxItem key={year} value={year}>
              {year}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

/** Archive/restore with a toast; shared by the department drawer and the batches table. */
function useArchiveToggle(collegeId: string) {
  const setArchived = useSetArchived(collegeId);
  return {
    pending: setArchived.isPending,
    toggle(table: "departments" | "batches", id: string, label: string, archive: boolean) {
      setArchived.mutate(
        { table, id, archived: archive },
        {
          onSuccess: () => toast.success(`${archive ? "Archived" : "Restored"} ${label}.`),
          onError: (err) => toast.error(err.message),
        },
      );
    },
  };
}

export function DeptsBatchesScreen() {
  const { isSuperadmin } = useIsSuperadmin();
  const { data: colleges = [], isPending: collegesPending } = useColleges();
  const [pickedId, setPickedId] = useState<string | null>(null);
  // Nothing is picked until the user chooses a college; drop the pick if it's no longer in the list.
  const college = colleges.find((c) => c.id === pickedId) ?? null;
  const collegeId = college?.id ?? null;

  const departments = useDepartments(collegeId);
  const batches = useBatches(collegeId);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const viewing = viewingId ? departments.data?.find((d) => d.id === viewingId) : undefined;
  // A batch's own pages (students, analytics), opened from the batches page.
  const [batchPage, setBatchPage] = useState<{ batchId: string; page: BatchPageKind } | null>(null);
  const openBatch = batchPage && viewing ? batches.data?.find((b) => b.id === batchPage.batchId && b.department_id === viewing.id) : undefined;

  function backToList() {
    setBatchPage(null);
    setViewingId(null);
  }

  useSetBreadcrumbTrail(
    viewing && college
      ? {
          items: openBatch
            ? [
                { label: college.code, onClick: backToList },
                { label: viewing.code, onClick: () => setBatchPage(null) },
                { label: openBatch.code },
                { label: BATCH_PAGES[batchPage!.page].title },
              ]
            : [{ label: college.code, onClick: backToList }, { label: viewing.code }],
          onRoot: backToList,
        }
      : null,
    viewing && college ? `${college.code}/${viewing.code}/${openBatch ? `${openBatch.code}/${batchPage!.page}` : ""}` : "",
  );

  if (!collegesPending && colleges.length === 0) {
    return (
      <div className="flex flex-1 flex-col gap-2 p-4 pt-0">
        <h1 className="text-2xl font-semibold">Depts & batches</h1>
        <p className="text-sm text-muted-foreground">
          {isSuperadmin ? "No colleges yet. Add one on the Colleges page first." : "No colleges yet. Add one on My colleges first."}
        </p>
      </div>
    );
  }

  if (viewing && college && openBatch && batchPage) {
    return <BatchPlaceholderPage batch={openBatch} department={viewing} page={batchPage.page} />;
  }

  if (viewing && college) {
    return (
      <DepartmentBatches
        college={college}
        department={viewing}
        batches={(batches.data ?? []).filter((b) => b.department_id === viewing.id)}
        loading={batches.isPending}
        loadError={batches.error}
        refreshing={batches.isFetching}
        onRefresh={() => void batches.refetch()}
        onOpenBatch={(batchId, page) => setBatchPage({ batchId, page })}
      />
    );
  }

  return (
    <DepartmentList
      colleges={colleges}
      collegesPending={collegesPending}
      collegeId={collegeId}
      onPickCollege={setPickedId}
      departments={departments}
      batches={batches.data ?? []}
      batchesPending={batches.isPending}
      batchesError={batches.error}
      onRefresh={() => {
        void departments.refetch();
        void batches.refetch();
      }}
      refreshing={departments.isFetching || batches.isFetching}
      onViewBatches={setViewingId}
    />
  );
}

function DepartmentList({
  colleges,
  collegesPending,
  collegeId,
  onPickCollege,
  departments,
  batches,
  batchesPending,
  batchesError,
  onRefresh,
  refreshing,
  onViewBatches,
}: {
  colleges: College[];
  collegesPending: boolean;
  collegeId: string | null;
  onPickCollege: (id: string) => void;
  departments: ReturnType<typeof useDepartments>;
  batches: Batch[];
  batchesPending: boolean;
  batchesError: Error | null;
  onRefresh: () => void;
  refreshing: boolean;
  onViewBatches: (departmentId: string) => void;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [deptDialog, setDeptDialog] = useState<{ department: Department | null } | null>(null);

  const batchCounts = useMemo(() => {
    const counts = new Map<string, { active: number; archived: number }>();
    for (const b of batches) {
      const c = counts.get(b.department_id) ?? { active: 0, archived: 0 };
      if (b.archived_at) c.archived += 1;
      else c.active += 1;
      counts.set(b.department_id, c);
    }
    return counts;
  }, [batches]);

  const visible = (departments.data ?? []).filter((d) => showArchived || !d.archived_at);
  const open = openId ? departments.data?.find((d) => d.id === openId) : undefined;
  const loading = departments.isPending || batchesPending;
  const loadError = departments.error ?? batchesError;

  return (
    <>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Depts & batches</h1>
            <p className="text-sm text-muted-foreground">Set up each college's departments and the batches under them.</p>
          </div>
          <div className="flex gap-2">
            <RefreshButton onRefresh={onRefresh} refreshing={refreshing} />
            <Button size="sm" disabled={!collegeId} onClick={() => setDeptDialog({ department: null })}>
              <PlusIcon />
              Add department
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {!collegesPending && (
            <CollegePicker
              colleges={colleges}
              value={collegeId}
              onChange={(id) => {
                onPickCollege(id);
                setOpenId(null);
              }}
            />
          )}
          <ShowArchivedSwitch checked={showArchived} onChange={setShowArchived} />
        </div>

        <div className="border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Code</TableHead>
                <TableHead>Department</TableHead>
                <TableHead className="w-28">Active batches</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {!collegesPending && !collegeId ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    Select a college to see its departments.
                  </TableCell>
                </TableRow>
              ) : collegesPending || loading ? (
                <TableSkeletonRows columns={["w-12", "w-48", "w-8", "w-16", "w-24"]} />
              ) : loadError || visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className={`h-24 text-center ${loadError ? "text-destructive" : "text-muted-foreground"}`}>
                    {loadError
                      ? `Could not load departments: ${loadError.message}`
                      : departments.data?.length
                        ? "All departments are archived. Turn on Show archived to see them."
                        : "No departments yet. Add one to get started."}
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((d) => (
                  <TableRow key={d.id} className="cursor-pointer" onClick={() => setOpenId(d.id)}>
                    <TableCell className="font-medium">{d.code}</TableCell>
                    <TableCell className="max-w-64 truncate">{d.name}</TableCell>
                    <TableCell>{batchCounts.get(d.id)?.active ?? 0}</TableCell>
                    <TableCell>
                      <StatusBadge archived={d.archived_at !== null} />
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end">
                        <Button variant="outline" size="sm" onClick={() => onViewBatches(d.id)}>
                          View batches
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Sheet open={open !== undefined} onOpenChange={(next) => !next && setOpenId(null)}>
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          {open && collegeId && (
            <DepartmentDetails
              collegeId={collegeId}
              department={open}
              counts={batchCounts.get(open.id) ?? { active: 0, archived: 0 }}
              onEdit={() => setDeptDialog({ department: open })}
              onViewBatches={() => onViewBatches(open.id)}
            />
          )}
        </SheetContent>
      </Sheet>

      {collegeId && <DepartmentDialog collegeId={collegeId} state={deptDialog} onClose={() => setDeptDialog(null)} />}
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm break-words">{value}</p>
    </div>
  );
}

/** Drawer: the department's details only. Its batches are managed on their own page. */
function DepartmentDetails({
  collegeId,
  department,
  counts,
  onEdit,
  onViewBatches,
}: {
  collegeId: string;
  department: Department;
  counts: { active: number; archived: number };
  onEdit: () => void;
  onViewBatches: () => void;
}) {
  const archive = useArchiveToggle(collegeId);
  const archived = department.archived_at !== null;

  return (
    <div className="flex flex-1 flex-col gap-5">
      <SheetHeader>
        <SheetTitle className="text-lg font-semibold break-words">{department.name}</SheetTitle>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-5 px-4 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{department.code}</Badge>
            <StatusBadge archived={archived} />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={archive.pending}
              onClick={() => archive.toggle("departments", department.id, department.code, !archived)}
            >
              {archived ? "Restore" : "Archive"}
            </Button>
            <Button variant="outline" size="sm" onClick={onEdit}>
              Edit
            </Button>
          </div>
        </div>
        {archived && <p className="-mt-3 text-xs text-muted-foreground">Archived departments keep their batches but can't get new ones.</p>}

        <div className="grid grid-cols-2 gap-4 border p-4">
          <Field label="Code" value={department.code} />
          <Field label="Name" value={department.name} />
          <Field label="Active batches" value={String(counts.active)} />
          <Field label="Archived batches" value={String(counts.archived)} />
          <Field label="Added on" value={new Date(department.created_at).toLocaleDateString()} />
        </div>

        <Button variant="outline" size="sm" className="self-start" onClick={onViewBatches}>
          View batches
        </Button>
      </div>
    </div>
  );
}

/** The batches page for one department. */
function DepartmentBatches({
  college,
  department,
  batches,
  loading,
  loadError,
  refreshing,
  onRefresh,
  onOpenBatch,
}: {
  college: College;
  department: Department;
  batches: Batch[];
  loading: boolean;
  loadError: Error | null;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenBatch: (batchId: string, page: BatchPageKind) => void;
}) {
  const archive = useArchiveToggle(college.id);
  const [showArchived, setShowArchived] = useState(false);
  const [addingBatch, setAddingBatch] = useState(false);
  const [year, setYear] = useState<number | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? batches.find((b) => b.id === openId) : undefined;
  const deptArchived = department.archived_at !== null;
  const shown = batches.filter((b) => showArchived || !b.archived_at);
  const years = [...new Set(shown.map((b) => b.graduation_year))].sort((a, b) => a - b);
  const visible = shown.filter((b) => year === null || b.graduation_year === year);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            {department.code} · {department.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            Batches of {college.name}. A batch is one section of a year's intake.
          </p>
        </div>
        <div className="flex gap-2">
          <RefreshButton onRefresh={onRefresh} refreshing={refreshing} />
          <Button size="sm" disabled={deptArchived} onClick={() => setAddingBatch(true)}>
            <PlusIcon />
            Add batch
          </Button>
        </div>
      </div>

      {deptArchived && (
        <p className="text-sm text-muted-foreground">This department is archived. Restore it to add batches.</p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <YearFilter years={years} value={year} onChange={setYear} />
        <ShowArchivedSwitch checked={showArchived} onChange={setShowArchived} />
      </div>

      <div className="border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead className="w-32">Graduates</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-64" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableSkeletonRows columns={["w-32", "w-12", "w-16", "w-48"]} />
            ) : loadError || visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className={`h-24 text-center ${loadError ? "text-destructive" : "text-muted-foreground"}`}>
                  {loadError
                    ? `Could not load batches: ${loadError.message}`
                    : shown.length
                      ? `No batches graduate in ${year}.`
                      : batches.length
                        ? "All batches are archived. Turn on Show archived to see them."
                        : "No batches yet. Add one to get started."}
                </TableCell>
              </TableRow>
            ) : (
              visible.map((b) => {
                const archived = b.archived_at !== null;
                return (
                  <TableRow key={b.id} className="cursor-pointer" onClick={() => setOpenId(b.id)}>
                    <TableCell className="font-medium">{b.code}</TableCell>
                    <TableCell>{b.graduation_year}</TableCell>
                    <TableCell>
                      <StatusBadge archived={archived} />
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <Button variant="outline" size="sm" onClick={() => onOpenBatch(b.id, "students")}>
                          View students
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => onOpenBatch(b.id, "analytics")}>
                          Analytics
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${archived ? "Restore" : "Archive"} ${b.code}`}
                          title={archived ? "Restore" : "Archive"}
                          disabled={archive.pending}
                          onClick={() => archive.toggle("batches", b.id, b.code, !archived)}
                        >
                          {archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet open={open !== undefined} onOpenChange={(next) => !next && setOpenId(null)}>
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          {open && <BatchDetails batch={open} department={department} onOpen={(page) => onOpenBatch(open.id, page)} />}
        </SheetContent>
      </Sheet>

      <BatchDialog collegeId={college.id} department={addingBatch ? department : null} onClose={() => setAddingBatch(false)} />
    </div>
  );
}

type BatchPageKind = "students" | "analytics";

const BATCH_PAGES: Record<BatchPageKind, { title: string; description: string }> = {
  students: {
    title: "Students",
    description: "The students in this batch: add them one by one or import a list, reset passwords, deactivate or move a student.",
  },
  analytics: {
    title: "Analytics",
    description: "How this batch is doing: participation, average marks, tests taken and topic-wise strengths and weaknesses.",
  },
};

// Filled in once student accounts, tests and results exist; until then the drawer shows placeholders.
const BATCH_STATS = ["Students", "Average marks", "Tests taken", "Topics covered"];

/** Drawer: a batch's details and headline numbers. */
function BatchDetails({ batch, department, onOpen }: { batch: Batch; department: Department; onOpen: (page: BatchPageKind) => void }) {
  return (
    <div className="flex flex-1 flex-col gap-5">
      <SheetHeader>
        <SheetTitle className="text-lg font-semibold break-words">{batch.code}</SheetTitle>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-5 px-4 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge archived={batch.archived_at !== null} />
        </div>

        <div className="grid grid-cols-2 gap-4 border p-4">
          <Field label="Department" value={`${department.code} · ${department.name}`} />
          <Field label="Graduates" value={String(batch.graduation_year)} />
          <Field label="Section" value={`B${String(batch.number).padStart(2, "0")}`} />
          <Field label="Added on" value={new Date(batch.created_at).toLocaleDateString()} />
        </div>

        <div className="grid gap-3 border p-4">
          <h2 className="text-sm font-semibold">At a glance</h2>
          <div className="grid grid-cols-2 gap-4">
            {BATCH_STATS.map((label) => (
              <div key={label} className="grid gap-0.5">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-lg font-semibold text-muted-foreground">—</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">These fill in once students are added and start taking tests.</p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpen("students")}>
            View students
          </Button>
          <Button variant="outline" size="sm" onClick={() => onOpen("analytics")}>
            Analytics
          </Button>
        </div>
      </div>
    </div>
  );
}

/** A batch's Students / Analytics page. Not built yet: shows what will live here. */
function BatchPlaceholderPage({ batch, department, page }: { batch: Batch; department: Department; page: BatchPageKind }) {
  const { title, description } = BATCH_PAGES[page];
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div>
        <h1 className="text-2xl font-semibold">
          {title} · {batch.code}
        </h1>
        <p className="text-sm text-muted-foreground">
          {department.name}, graduating {batch.graduation_year}.
        </p>
      </div>
      <div className="grid gap-1 border p-4">
        <p className="text-sm font-medium">Coming soon</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
