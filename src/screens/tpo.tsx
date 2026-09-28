import { useMemo, useState } from "react";
import { KeyRoundIcon, Loader2Icon, PencilIcon, PlusIcon, SearchIcon, UserCheckIcon, UserXIcon } from "lucide-react";
import { toast } from "sonner";
import { CollegePicker } from "@/components/college-picker";
import { FilterSelect } from "@/components/filter-select";
import { RefreshButton } from "@/components/refresh-button";
import { ResetTpoPasswordDialog } from "@/components/reset-tpo-password-dialog";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { TpoDialog, type TpoDialogState } from "@/components/tpo-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useColleges } from "@/lib/colleges";
import { type Faculty, useCollegeFaculty } from "@/lib/faculty";
import { useIsSuperadmin } from "@/lib/roles";
import { type Tpo, type TpoDesignation, useCollegeTpos, useSetTpoStatus, useTpoDesignations } from "@/lib/tpo";

// TPOs of one college (superadmin: any college; onboarding manager: their colleges). Pick a college, then the list.
// A TPO is either a new login or an existing faculty member of the college on the same login (shown by their faculty
// ID). Each row has edit, reset password and deactivate/reactivate buttons; clicking the row opens a drawer with the
// full details (and the same actions).

const ALL = "all";
const ALSO_FACULTY = "faculty";
const NOT_FACULTY = "not-faculty";

function StatusBadge({ status }: { status: Tpo["status"] }) {
  return <Badge variant={status === "active" ? "default" : "secondary"}>{status}</Badge>;
}

export function TpoScreen() {
  const { isSuperadmin } = useIsSuperadmin();
  const { data: colleges = [], isPending: collegesPending } = useColleges();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const college = colleges.find((c) => c.id === pickedId) ?? null;
  const collegeId = college?.id ?? null;

  const tpos = useCollegeTpos(collegeId);
  const faculty = useCollegeFaculty(collegeId);
  const { data: designations = [] } = useTpoDesignations();

  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState(ALL);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<TpoDialogState>(null);
  const [resetting, setResetting] = useState<Tpo | null>(null);

  // A TPO who is also faculty shares the faculty member's id (one login).
  const facultyById = useMemo(() => new Map((faculty.data ?? []).map((f) => [f.id, f])), [faculty.data]);
  const designationById = useMemo(() => new Map(designations.map((d) => [d.id, d])), [designations]);
  const eligibleFaculty = useMemo(() => {
    const tpoIds = new Set((tpos.data ?? []).map((t) => t.id));
    return (faculty.data ?? []).filter((f) => f.status === "active" && !tpoIds.has(f.id));
  }, [faculty.data, tpos.data]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (tpos.data ?? []).filter((t) => {
      const isFaculty = facultyById.has(t.id);
      if ((kindFilter === ALSO_FACULTY && !isFaculty) || (kindFilter === NOT_FACULTY && isFaculty)) return false;
      return !q || [t.code, t.full_name, t.email, t.phone ?? "", facultyById.get(t.id)?.code ?? ""].some((v) => v.toLowerCase().includes(q));
    });
  }, [tpos.data, facultyById, query, kindFilter]);

  const kindItems = [
    { value: ALL, label: "All TPOs" },
    { value: ALSO_FACULTY, label: "Also faculty" },
    { value: NOT_FACULTY, label: "Not faculty" },
  ];

  const open = openId ? tpos.data?.find((t) => t.id === openId) : undefined;
  const loading = tpos.isPending || faculty.isPending;
  const loadError = tpos.error ?? faculty.error;
  const refreshing = tpos.isFetching || faculty.isFetching;
  const editingFaculty = dialog?.mode === "edit" ? facultyById.get(dialog.tpo.id) : undefined;

  if (!collegesPending && colleges.length === 0) {
    return (
      <div className="flex flex-1 flex-col gap-2 p-4 pt-0">
        <h1 className="text-2xl font-semibold">TPO</h1>
        <p className="text-sm text-muted-foreground">
          {isSuperadmin ? "No colleges yet. Add one on the Colleges page first." : "No colleges yet. Add one on My colleges first."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">TPO</h1>
          <p className="text-sm text-muted-foreground">Training & placement officers of each college. A TPO can also be one of its faculty.</p>
        </div>
        <div className="flex gap-2">
          <RefreshButton
            onRefresh={() => {
              void tpos.refetch();
              void faculty.refetch();
            }}
            refreshing={refreshing}
          />
          <Button variant="outline" size="sm" disabled={!college} onClick={() => setDialog({ mode: "faculty" })}>
            <PlusIcon />
            Add from faculty
          </Button>
          <Button size="sm" disabled={!college} onClick={() => setDialog({ mode: "new" })}>
            <PlusIcon />
            Add TPO
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
              setKindFilter(ALL);
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
        <FilterSelect value={kindFilter} onChange={setKindFilter} items={kindItems} className="w-44" aria-label="Faculty" />
      </div>

      <div className="border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">TPO ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="w-52">Designation</TableHead>
              <TableHead className="w-28">Faculty ID</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!collegesPending && !college ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  Select a college to see its TPOs.
                </TableCell>
              </TableRow>
            ) : collegesPending || loading ? (
              <TableSkeletonRows columns={["w-16", "w-32", "w-44", "w-32", "w-16", "w-14", "w-20 ml-auto"]} />
            ) : loadError || visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className={`h-24 text-center ${loadError ? "text-destructive" : "text-muted-foreground"}`}>
                  {loadError
                    ? `Could not load TPOs: ${loadError.message}`
                    : tpos.data?.length
                      ? "No TPOs match."
                      : "No TPOs yet. Add one to get started."}
                </TableCell>
              </TableRow>
            ) : (
              visible.map((t) => (
                <TableRow key={t.id} className="cursor-pointer" onClick={() => setOpenId(t.id)}>
                  <TableCell className="font-medium">{t.code}</TableCell>
                  <TableCell className="max-w-48 truncate">{t.full_name}</TableCell>
                  <TableCell className="max-w-56 truncate text-muted-foreground">{t.email}</TableCell>
                  <TableCell className="truncate">{(t.designation_id && designationById.get(t.designation_id)?.label) ?? "—"}</TableCell>
                  <TableCell>{facultyById.get(t.id)?.code ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={t.status} />
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${t.full_name}`} onClick={() => setDialog({ mode: "edit", tpo: t })}>
                        <PencilIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Reset password"
                        aria-label={`Reset password for ${t.full_name}`}
                        onClick={() => setResetting(t)}
                      >
                        <KeyRoundIcon />
                      </Button>
                      <TpoStatusButton tpo={t} faculty={facultyById.get(t.id)} collegeId={t.college_id} />
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
            <TpoDetails
              tpo={open}
              faculty={facultyById.get(open.id)}
              collegeId={collegeId}
              designation={open.designation_id ? designationById.get(open.designation_id) : undefined}
              onEdit={() => setDialog({ mode: "edit", tpo: open })}
              onResetPassword={() => setResetting(open)}
            />
          )}
        </SheetContent>
      </Sheet>

      {college && (
        <TpoDialog
          state={dialog}
          collegeId={college.id}
          collegeCode={college.code}
          designations={designations}
          eligibleFaculty={eligibleFaculty}
          facultyCode={editingFaculty?.code}
          onClose={() => setDialog(null)}
        />
      )}
      <ResetTpoPasswordDialog tpo={resetting} alsoFaculty={!!resetting && facultyById.has(resetting.id)} onClose={() => setResetting(null)} />
    </div>
  );
}

/** Toast after a status change. A TPO who is also active faculty keeps signing in as faculty when deactivated. */
function statusMessage(tpo: Tpo, faculty: Faculty | undefined, activated: boolean) {
  if (activated) return `Reactivated ${tpo.full_name}.`;
  return faculty?.status === "active"
    ? `Deactivated ${tpo.full_name} as TPO. They can still sign in as faculty.`
    : `Deactivated ${tpo.full_name}. They can't sign in.`;
}

/** Deactivates or reactivates in one click. */
function TpoStatusButton({ tpo, faculty, collegeId }: { tpo: Tpo; faculty: Faculty | undefined; collegeId: string }) {
  const setStatus = useSetTpoStatus(collegeId);
  const activate = tpo.status === "inactive";
  const label = activate ? "Reactivate" : "Deactivate";

  function handleClick() {
    setStatus.mutate(
      { tpoId: tpo.id, status: activate ? "active" : "inactive" },
      {
        onSuccess: () => toast.success(statusMessage(tpo, faculty, activate)),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Button variant="ghost" size="icon-sm" title={label} aria-label={`${label} ${tpo.full_name}`} disabled={setStatus.isPending} onClick={handleClick}>
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

/** Drawer: one TPO's details, edit, reset password and deactivate/reactivate. */
function TpoDetails({
  tpo,
  faculty,
  collegeId,
  designation,
  onEdit,
  onResetPassword,
}: {
  tpo: Tpo;
  faculty: Faculty | undefined;
  collegeId: string;
  designation: TpoDesignation | undefined;
  onEdit: () => void;
  onResetPassword: () => void;
}) {
  const setStatus = useSetTpoStatus(collegeId);
  const active = tpo.status === "active";

  function handleStatus() {
    setStatus.mutate(
      { tpoId: tpo.id, status: active ? "inactive" : "active" },
      {
        onSuccess: () => toast.success(statusMessage(tpo, faculty, !active)),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      <SheetHeader>
        <SheetTitle className="text-lg font-semibold break-words">{tpo.full_name}</SheetTitle>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-5 px-4 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{tpo.code}</Badge>
            <StatusBadge status={tpo.status} />
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
          <Field label="TPO ID" value={tpo.code} />
          <Field label="Phone" value={tpo.phone ?? "—"} />
          <Field label="Email" value={tpo.email} />
          <Field label="Designation" value={designation ? `${designation.label}${designation.is_active ? "" : " (retired)"}` : "—"} />
          <Field label="Added on" value={new Date(tpo.created_at).toLocaleDateString()} />
        </div>

        <div className="grid gap-2">
          <p className="text-sm font-medium">Faculty</p>
          {faculty ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{faculty.code}</Badge>
                <StatusBadge status={faculty.status} />
              </div>
              <p className="text-xs text-muted-foreground">
                Also faculty of this college, on the same sign-in: one email and password, and they switch between Faculty and
                TPO in the app. Name and phone are shared with their faculty record.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Not faculty. A TPO-only sign-in.</p>
          )}
          {!active && (
            <p className="text-xs text-muted-foreground">
              {faculty?.status === "active" ? "Inactive as TPO: they still sign in as faculty." : "Inactive: can't sign in."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
