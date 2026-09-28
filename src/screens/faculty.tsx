import { useMemo, useState } from "react";
import { GraduationCapIcon, KeyRoundIcon, Loader2Icon, PencilIcon, PlusIcon, SearchIcon, UserCheckIcon, UserXIcon } from "lucide-react";
import { toast } from "sonner";
import { CollegePicker } from "@/components/college-picker";
import { FacultyDialog, type FacultyDialogState } from "@/components/faculty-dialog";
import { FilterSelect } from "@/components/filter-select";
import { RefreshButton } from "@/components/refresh-button";
import { ResetFacultyPasswordDialog } from "@/components/reset-faculty-password-dialog";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSetBreadcrumbTrail } from "@/hooks/use-breadcrumb";
import { useColleges } from "@/lib/colleges";
import { type Faculty, type FacultyRole, useCollegeFaculty, useFacultyAssignments, useFacultyRoles, useSetFacultyStatus } from "@/lib/faculty";
import { useIsSuperadmin } from "@/lib/roles";
import { type Batch, type Department, useBatches, useDepartments } from "@/lib/structure";
import { FacultyBatchesPage } from "@/screens/faculty-batches";

// Faculty of one college (superadmin: any college; onboarding manager: their colleges). Pick a college, then the
// list. Each row has edit, reset password and deactivate/reactivate buttons; clicking the row opens a drawer with
// the full details (and the same actions). "Manage batches" opens the faculty member's Batches page (assign,
// unassign, past assignments).

const ALL = "all";
const NO_DEPARTMENT = "none";

function StatusBadge({ status }: { status: Faculty["status"] }) {
  return <Badge variant={status === "active" ? "default" : "secondary"}>{status}</Badge>;
}

export function FacultyScreen() {
  const { isSuperadmin } = useIsSuperadmin();
  const { data: colleges = [], isPending: collegesPending } = useColleges();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const college = colleges.find((c) => c.id === pickedId) ?? null;
  const collegeId = college?.id ?? null;

  const faculty = useCollegeFaculty(collegeId);
  const assignments = useFacultyAssignments(collegeId);
  const departments = useDepartments(collegeId);
  const batches = useBatches(collegeId);
  const { data: roles = [] } = useFacultyRoles();

  const [query, setQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState(ALL);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<FacultyDialogState>(null);
  const [resetting, setResetting] = useState<Faculty | null>(null);
  // The faculty member whose Batches page is open (a drill-down page, not a drawer).
  const [batchesForId, setBatchesForId] = useState<string | null>(null);
  const batchesFor = batchesForId ? faculty.data?.find((f) => f.id === batchesForId) : undefined;

  function openBatches(facultyId: string) {
    setOpenId(null);
    setBatchesForId(facultyId);
  }

  useSetBreadcrumbTrail(
    batchesFor && college
      ? {
          items: [{ label: college.code, onClick: () => setBatchesForId(null) }, { label: batchesFor.code }, { label: "Batches" }],
          onRoot: () => setBatchesForId(null),
        }
      : null,
    batchesFor && college ? `${college.code}/${batchesFor.code}/batches` : "",
  );

  const departmentById = useMemo(() => new Map((departments.data ?? []).map((d) => [d.id, d])), [departments.data]);
  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (faculty.data ?? []).filter((f) => {
      if (departmentFilter === NO_DEPARTMENT ? f.department_id !== null : departmentFilter !== ALL && f.department_id !== departmentFilter) {
        return false;
      }
      return !q || [f.code, f.full_name, f.email, f.phone ?? ""].some((v) => v.toLowerCase().includes(q));
    });
  }, [faculty.data, query, departmentFilter]);

  const departmentItems = [
    { value: ALL, label: "All departments" },
    ...(departments.data ?? []).map((d) => ({ value: d.id, label: `${d.code} · ${d.name}` })),
    { value: NO_DEPARTMENT, label: "No department" },
  ];

  const open = openId ? faculty.data?.find((f) => f.id === openId) : undefined;
  const loading = faculty.isPending || assignments.isPending || departments.isPending;
  const loadError = faculty.error ?? assignments.error ?? departments.error;
  const refreshing = faculty.isFetching || assignments.isFetching || departments.isFetching || batches.isFetching;

  if (!collegesPending && colleges.length === 0) {
    return (
      <div className="flex flex-1 flex-col gap-2 p-4 pt-0">
        <h1 className="text-2xl font-semibold">Faculty</h1>
        <p className="text-sm text-muted-foreground">
          {isSuperadmin ? "No colleges yet. Add one on the Colleges page first." : "No colleges yet. Add one on My colleges first."}
        </p>
      </div>
    );
  }

  if (batchesFor) {
    return (
      <FacultyBatchesPage
        faculty={batchesFor}
        batches={batches.data ?? []}
        departments={departments.data ?? []}
        batchesLoading={batches.isPending || departments.isPending}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Faculty</h1>
          <p className="text-sm text-muted-foreground">Faculty accounts of each college, and the batches they're assigned to.</p>
        </div>
        <div className="flex gap-2">
          <RefreshButton
            onRefresh={() => {
              void faculty.refetch();
              void assignments.refetch();
              void departments.refetch();
              void batches.refetch();
            }}
            refreshing={refreshing}
          />
          <Button size="sm" disabled={!college} onClick={() => setDialog({ faculty: null })}>
            <PlusIcon />
            Add faculty
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        {!collegesPending && (
          <CollegePicker
            colleges={colleges}
            value={collegeId}
            onChange={(id) => {
              setPickedId(id);
              setOpenId(null);
              setDepartmentFilter(ALL);
            }}
          />
        )}
        <div className="relative w-72">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by ID, name, email or phone"
            value={query}
            disabled={!college}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <FilterSelect
          value={departmentFilter}
          onChange={setDepartmentFilter}
          items={departmentItems}
          className="w-56"
          aria-label="Department"
        />
      </div>

      <div className="border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Faculty ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="w-24">Department</TableHead>
              <TableHead className="w-44">Current role</TableHead>
              <TableHead className="w-20">Batches</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-36" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!collegesPending && !college ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  Select a college to see its faculty.
                </TableCell>
              </TableRow>
            ) : collegesPending || loading ? (
              <TableSkeletonRows columns={["w-16", "w-32", "w-44", "w-10", "w-28", "w-6", "w-14", "w-28 ml-auto"]} />
            ) : loadError || visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className={`h-24 text-center ${loadError ? "text-destructive" : "text-muted-foreground"}`}>
                  {loadError
                    ? `Could not load faculty: ${loadError.message}`
                    : faculty.data?.length
                      ? "No faculty match."
                      : "No faculty yet. Add one to get started."}
                </TableCell>
              </TableRow>
            ) : (
              visible.map((f) => (
                <TableRow key={f.id} className="cursor-pointer" onClick={() => setOpenId(f.id)}>
                  <TableCell className="font-medium">{f.code}</TableCell>
                  <TableCell className="max-w-48 truncate">{f.full_name}</TableCell>
                  <TableCell className="max-w-56 truncate text-muted-foreground">{f.email}</TableCell>
                  <TableCell>{(f.department_id && departmentById.get(f.department_id)?.code) ?? "—"}</TableCell>
                  <TableCell className="truncate">{(f.faculty_role_id && roleById.get(f.faculty_role_id)?.label) ?? "—"}</TableCell>
                  <TableCell>{assignments.data?.get(f.id)?.length ?? 0}</TableCell>
                  <TableCell>
                    <StatusBadge status={f.status} />
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${f.full_name}`} onClick={() => setDialog({ faculty: f })}>
                        <PencilIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Reset password"
                        aria-label={`Reset password for ${f.full_name}`}
                        onClick={() => setResetting(f)}
                      >
                        <KeyRoundIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Manage batches"
                        aria-label={`Manage batches of ${f.full_name}`}
                        onClick={() => openBatches(f.id)}
                      >
                        <GraduationCapIcon />
                      </Button>
                      <FacultyStatusButton faculty={f} collegeId={f.college_id} />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet open={open !== undefined} onOpenChange={(next) => !next && setOpenId(null)}>
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          {open && collegeId && (
            <FacultyDetails
              faculty={open}
              collegeId={collegeId}
              department={open.department_id ? departmentById.get(open.department_id) : undefined}
              role={open.faculty_role_id ? roleById.get(open.faculty_role_id) : undefined}
              batches={(assignments.data?.get(open.id) ?? [])
                .map((id) => batches.data?.find((b) => b.id === id))
                .filter((b): b is Batch => b !== undefined)}
              onEdit={() => setDialog({ faculty: open })}
              onResetPassword={() => setResetting(open)}
              onManageBatches={() => openBatches(open.id)}
            />
          )}
        </SheetContent>
      </Sheet>

      {college && (
        <FacultyDialog
          state={dialog}
          collegeId={college.id}
          collegeCode={college.code}
          departments={departments.data ?? []}
          roles={roles}
          onClose={() => setDialog(null)}
        />
      )}
      <ResetFacultyPasswordDialog faculty={resetting} onClose={() => setResetting(null)} />
    </div>
  );
}

/** Deactivates or reactivates in one click (deactivating also blocks sign-in; their batches are kept). */
function FacultyStatusButton({ faculty, collegeId }: { faculty: Faculty; collegeId: string }) {
  const setStatus = useSetFacultyStatus(collegeId);
  const activate = faculty.status === "inactive";
  const label = activate ? "Reactivate" : "Deactivate";

  function handleClick() {
    setStatus.mutate(
      { facultyId: faculty.id, status: activate ? "active" : "inactive" },
      {
        onSuccess: () => toast.success(activate ? `Reactivated ${faculty.full_name}.` : `Deactivated ${faculty.full_name}. They can't sign in.`),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Button variant="ghost" size="icon-sm" title={label} aria-label={`${label} ${faculty.full_name}`} disabled={setStatus.isPending} onClick={handleClick}>
      {setStatus.isPending ? <Loader2Icon className="animate-spin" /> : activate ? <UserCheckIcon /> : <UserXIcon />}
    </Button>
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

/** Drawer: one faculty member's details, edit, reset password and deactivate/reactivate. */
function FacultyDetails({
  faculty,
  collegeId,
  department,
  role,
  batches,
  onEdit,
  onResetPassword,
  onManageBatches,
}: {
  faculty: Faculty;
  collegeId: string;
  department: Department | undefined;
  role: FacultyRole | undefined;
  batches: Batch[];
  onEdit: () => void;
  onResetPassword: () => void;
  onManageBatches: () => void;
}) {
  const setStatus = useSetFacultyStatus(collegeId);
  const active = faculty.status === "active";

  function handleStatus() {
    setStatus.mutate(
      { facultyId: faculty.id, status: active ? "inactive" : "active" },
      {
        onSuccess: () => toast.success(active ? `Deactivated ${faculty.full_name}. They can't sign in.` : `Reactivated ${faculty.full_name}.`),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      <SheetHeader>
        <SheetTitle className="text-lg font-semibold break-words">{faculty.full_name}</SheetTitle>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-5 px-4 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{faculty.code}</Badge>
            <StatusBadge status={faculty.status} />
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onEdit}>
              Edit
            </Button>
            <Button variant="outline" size="sm" onClick={onResetPassword}>
              Reset password
            </Button>
            <Button variant="outline" size="sm" disabled={setStatus.isPending} onClick={handleStatus}>
              {active ? "Deactivate" : "Reactivate"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 border p-4">
          <Field label="Faculty ID" value={faculty.code} />
          <Field label="Phone" value={faculty.phone ?? "—"} />
          <Field label="Email" value={faculty.email} />
          <Field label="Current role" value={role ? `${role.label}${role.is_active ? "" : " (retired)"}` : "—"} />
          <Field
            label="Department"
            value={department ? `${department.code} · ${department.name}${department.archived_at ? " (archived)" : ""}` : "—"}
          />
          <Field label="Added on" value={new Date(faculty.created_at).toLocaleDateString()} />
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Batches</p>
            <Button variant="outline" size="sm" onClick={onManageBatches}>
              Manage batches
            </Button>
          </div>
          {batches.length === 0 ? (
            <p className="text-sm text-muted-foreground">Not assigned to any batch yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {batches.map((b) => (
                <Badge key={b.id} variant="outline">
                  {b.code}
                </Badge>
              ))}
            </div>
          )}
          {!active && <p className="text-xs text-muted-foreground">Inactive: can't sign in. Their batches are kept.</p>}
        </div>
      </div>
    </div>
  );
}
