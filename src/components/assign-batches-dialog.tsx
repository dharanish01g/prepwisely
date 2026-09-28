import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FilterSelect } from "@/components/filter-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { type Faculty, useAssignBatches } from "@/lib/faculty";
import type { Batch, Department } from "@/lib/structure";

// Pick one or more of the college's batches for a faculty member. Archived batches and batches they already have are
// left out, so nothing can be picked twice. All the picked batches are assigned together, or none are.

const ALL_YEARS = "all";

interface AssignBatchesDialogProps {
  open: boolean;
  faculty: Faculty;
  batches: Batch[];
  departments: Department[];
  /** Batches the faculty member currently has. */
  assignedIds: Set<string>;
  onClose: () => void;
}

export function AssignBatchesDialog({ open, onClose, ...props }: AssignBatchesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>{open && <AssignForm {...props} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function AssignForm({ faculty, batches, departments, assignedIds, onClose }: Omit<AssignBatchesDialogProps, "open">) {
  const [year, setYear] = useState(ALL_YEARS);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const assign = useAssignBatches(faculty.college_id, faculty.id);

  const available = useMemo(() => batches.filter((b) => !b.archived_at && !assignedIds.has(b.id)), [batches, assignedIds]);
  const years = [...new Set(available.map((b) => b.graduation_year))].sort();
  const shown = available.filter((b) => year === ALL_YEARS || b.graduation_year === Number(year));
  // Grouped by department, in department-code order; departments with nothing to show are skipped.
  const groups = [...departments]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((d) => ({ department: d, batches: shown.filter((b) => b.department_id === d.id) }))
    .filter((g) => g.batches.length > 0);

  function toggle(batchId: string, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(batchId);
      else next.delete(batchId);
      return next;
    });
  }

  function handleAssign() {
    setProblem(null);
    assign.mutate([...picked], {
      onSuccess: (count) => {
        toast.success(`Assigned ${count} batch${count === 1 ? "" : "es"} to ${faculty.full_name}.`);
        onClose();
      },
      onError: (err) => setProblem(err.message),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Assign batches to {faculty.code}</DialogTitle>
        <DialogDescription>
          {faculty.full_name} will see the students of the batches you pick. Archived batches and batches they already have
          aren't listed.
        </DialogDescription>
      </DialogHeader>

      {available.length === 0 ? (
        <p className="text-sm text-muted-foreground">No batches left to assign in this college.</p>
      ) : (
        <>
          <FilterSelect
            value={year}
            onChange={setYear}
            items={[{ value: ALL_YEARS, label: "All years" }, ...years.map((y) => ({ value: String(y), label: `Graduating ${y}` }))]}
            aria-label="Graduation year"
          />
          <div className="grid max-h-80 gap-4 overflow-y-auto border p-3">
            {groups.map(({ department, batches: list }) => (
              <div key={department.id} className="grid gap-2">
                <p className="text-xs text-muted-foreground">
                  {department.code} · {department.name}
                </p>
                {list.map((b) => (
                  <div key={b.id} className="flex items-center gap-2">
                    <Checkbox id={`assign_${b.id}`} checked={picked.has(b.id)} onCheckedChange={(on) => toggle(b.id, on)} />
                    <Label htmlFor={`assign_${b.id}`} className="cursor-pointer font-normal">
                      {b.code}
                    </Label>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      {problem && <p className="text-xs text-destructive">{problem}</p>}

      <DialogFooter>
        <Button disabled={picked.size === 0 || assign.isPending} onClick={handleAssign}>
          {assign.isPending ? "Assigning…" : picked.size > 1 ? `Assign ${picked.size} batches` : "Assign batch"}
        </Button>
      </DialogFooter>
    </div>
  );
}
