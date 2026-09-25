import { useState } from "react";
import { PlusIcon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { AddStudentDialog } from "@/components/add-student-dialog";
import { ImportStudentsDialog } from "@/components/import-students-dialog";
import { RefreshButton } from "@/components/refresh-button";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { College } from "@/lib/colleges";
import type { Batch, Department } from "@/lib/structure";
import { batchPassword, type Student, useBatchStudents, useResetStudentPassword, useSetStudentStatus } from "@/lib/students";

// A batch's Students page (Depts & batches › SEC › ECE › SEC-ECE-2027-B01 › Students): the list, adding one student,
// importing a file, and a drawer per student with reset password and deactivate/reactivate.

function StatusBadge({ status }: { status: Student["status"] }) {
  return <Badge variant={status === "active" ? "default" : "secondary"}>{status}</Badge>;
}

export function BatchStudentsPage({ college, department, batch }: { college: College; department: Department; batch: Batch }) {
  const { data: students = [], isPending, isFetching, error, refetch } = useBatchStudents(batch.id);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? students.find((s) => s.id === openId) : undefined;
  const archived = batch.archived_at !== null;
  const active = students.filter((s) => s.status === "active").length;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Students · {batch.code}</h1>
          <p className="text-sm text-muted-foreground">
            {department.name}, graduating {batch.graduation_year}.
            {!isPending && ` ${active} active student${active === 1 ? "" : "s"}.`}
          </p>
        </div>
        <div className="flex gap-2">
          <RefreshButton onRefresh={() => void refetch()} refreshing={isFetching} />
          <Button size="sm" variant="outline" disabled={archived} onClick={() => setImporting(true)}>
            <UploadIcon />
            Import students
          </Button>
          <Button size="sm" disabled={archived} onClick={() => setAdding(true)}>
            <PlusIcon />
            Add student
          </Button>
        </div>
      </div>

      {archived && <p className="text-sm text-muted-foreground">This batch is archived. Restore it to add students.</p>}

      <div className="border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">Roll number</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="w-32">Phone</TableHead>
              <TableHead className="w-24">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableSkeletonRows columns={["w-20", "w-32", "w-44", "w-20", "w-14"]} />
            ) : error || students.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className={`h-24 text-center ${error ? "text-destructive" : "text-muted-foreground"}`}>
                  {error ? `Could not load students: ${error.message}` : "No students yet. Add one, or import a file."}
                </TableCell>
              </TableRow>
            ) : (
              students.map((s) => (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => setOpenId(s.id)}>
                  <TableCell className="font-medium">{s.roll_number}</TableCell>
                  <TableCell className="max-w-48 truncate">{s.full_name}</TableCell>
                  <TableCell className="max-w-56 truncate text-muted-foreground">{s.email}</TableCell>
                  <TableCell className="text-muted-foreground">{s.phone ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={s.status} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet open={open !== undefined} onOpenChange={(next) => !next && setOpenId(null)}>
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          {open && <StudentDetails student={open} batch={batch} department={department} collegeId={college.id} />}
        </SheetContent>
      </Sheet>

      <AddStudentDialog open={adding} batchId={batch.id} batchCode={batch.code} collegeId={college.id} onClose={() => setAdding(false)} />
      <ImportStudentsDialog open={importing} batchId={batch.id} batchCode={batch.code} collegeId={college.id} onClose={() => setImporting(false)} />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm break-all">{value}</p>
    </div>
  );
}

/** Drawer: one student's details, reset password and deactivate/reactivate. */
function StudentDetails({ student, batch, department, collegeId }: { student: Student; batch: Batch; department: Department; collegeId: string }) {
  const resetPassword = useResetStudentPassword();
  const setStatus = useSetStudentStatus(batch.id, collegeId);
  const active = student.status === "active";

  function handleReset() {
    resetPassword.mutate(student.id, {
      onSuccess: () => toast.success(`${student.full_name}'s password is ${batchPassword(batch.code)} again.`),
      onError: (err) => toast.error(err.message),
    });
  }

  function handleStatus() {
    setStatus.mutate(
      { studentId: student.id, status: active ? "inactive" : "active" },
      {
        onSuccess: () => toast.success(active ? `Deactivated ${student.full_name}. They can't sign in.` : `Reactivated ${student.full_name}.`),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      <SheetHeader>
        <SheetTitle className="text-lg font-semibold break-words">{student.full_name}</SheetTitle>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-5 px-4 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{student.roll_number}</Badge>
            <StatusBadge status={student.status} />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" disabled={resetPassword.isPending} onClick={handleReset}>
              {resetPassword.isPending ? "Resetting…" : "Reset password"}
            </Button>
            <Button variant="outline" size="sm" disabled={setStatus.isPending} onClick={handleStatus}>
              {active ? "Deactivate" : "Reactivate"}
            </Button>
          </div>
        </div>
        <p className="-mt-3 text-xs text-muted-foreground">Reset password sets it back to {batchPassword(batch.code)}.</p>

        <div className="grid grid-cols-2 gap-4 border p-4">
          <Field label="Roll number" value={student.roll_number} />
          <Field label="Phone" value={student.phone ?? "—"} />
          <Field label="Email" value={student.email} />
          <Field label="Batch" value={batch.code} />
          <Field label="Department" value={`${department.code} · ${department.name}`} />
          <Field label="Added on" value={new Date(student.created_at).toLocaleDateString()} />
        </div>
      </div>
    </div>
  );
}
