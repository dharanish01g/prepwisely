import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { AssignBatchesDialog } from "@/components/assign-batches-dialog";
import { RefreshButton } from "@/components/refresh-button";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type Faculty, type FacultyAssignment, useFacultyBatchHistory, useUnassignBatch } from "@/lib/faculty";
import type { Batch, Department } from "@/lib/structure";

// A faculty member's batches (Faculty › SEC › SEC-F7K2 › Batches): the ones they have now, assigning more, unassigning,
// and past assignments. Unassigning never deletes: the assignment is kept with the date it ended.

const formatDate = (iso: string) => new Date(iso).toLocaleDateString();

interface FacultyBatchesPageProps {
  faculty: Faculty;
  batches: Batch[];
  departments: Department[];
  batchesLoading: boolean;
}

export function FacultyBatchesPage({ faculty, batches, departments, batchesLoading }: FacultyBatchesPageProps) {
  const history = useFacultyBatchHistory(faculty.id);
  const unassign = useUnassignBatch(faculty.college_id, faculty.id);
  const [assigning, setAssigning] = useState(false);

  const batchById = new Map(batches.map((b) => [b.id, b]));
  const departmentById = new Map(departments.map((d) => [d.id, d]));
  const current = (history.data ?? []).filter((a) => a.unassigned_at === null);
  const past = (history.data ?? []).filter((a) => a.unassigned_at !== null);
  const active = faculty.status === "active";
  const loading = history.isPending || batchesLoading;

  function handleUnassign(batch: Batch) {
    unassign.mutate(batch.id, {
      onSuccess: () => toast.success(`Unassigned ${batch.code} from ${faculty.full_name}.`),
      onError: (err) => toast.error(err.message),
    });
  }

  /** Batch code, department and graduation year of an assignment (the batch may be archived since). */
  function describe(a: FacultyAssignment) {
    const batch = batchById.get(a.batch_id);
    const department = batch ? departmentById.get(batch.department_id) : undefined;
    return { batch, department };
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Batches · {faculty.code}</h1>
          <p className="text-sm text-muted-foreground">
            {faculty.full_name} sees the students of these batches.
            {!loading && ` ${current.length} batch${current.length === 1 ? "" : "es"} now.`}
          </p>
        </div>
        <div className="flex gap-2">
          <RefreshButton onRefresh={() => void history.refetch()} refreshing={history.isFetching} />
          <Button size="sm" disabled={!active || loading} onClick={() => setAssigning(true)}>
            <PlusIcon />
            Assign batches
          </Button>
        </div>
      </div>

      {!active && <p className="text-sm text-muted-foreground">This faculty member is inactive. Reactivate them to assign batches.</p>}

      <div className="border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Batch</TableHead>
              <TableHead>Department</TableHead>
              <TableHead className="w-28">Graduates</TableHead>
              <TableHead className="w-32">Assigned on</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableSkeletonRows columns={["w-32", "w-40", "w-10", "w-20", "w-16 ml-auto"]} />
            ) : history.error || current.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className={`h-24 text-center ${history.error ? "text-destructive" : "text-muted-foreground"}`}>
                  {history.error ? `Could not load batches: ${history.error.message}` : "No batches yet. Assign one to get started."}
                </TableCell>
              </TableRow>
            ) : (
              current.map((a) => {
                const { batch, department } = describe(a);
                return (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {batch?.code ?? "—"}
                        {batch?.archived_at && <Badge variant="secondary">archived</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-64 truncate">{department ? `${department.code} · ${department.name}` : "—"}</TableCell>
                    <TableCell>{batch?.graduation_year ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(a.assigned_at)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <Button variant="outline" size="sm" disabled={!batch || unassign.isPending} onClick={() => batch && handleUnassign(batch)}>
                          Unassign
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

      {past.length > 0 && (
        <div className="grid gap-2">
          <p className="text-sm font-medium">Past assignments</p>
          <div className="border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead className="w-32">Assigned on</TableHead>
                  <TableHead className="w-32">Ended on</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {past.map((a) => {
                  const { batch, department } = describe(a);
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{batch?.code ?? "—"}</TableCell>
                      <TableCell className="max-w-64 truncate">{department ? `${department.code} · ${department.name}` : "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(a.assigned_at)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(a.unassigned_at!)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <AssignBatchesDialog
        open={assigning}
        faculty={faculty}
        batches={batches}
        departments={departments}
        assignedIds={new Set(current.map((a) => a.batch_id))}
        onClose={() => setAssigning(false)}
      />
    </div>
  );
}
