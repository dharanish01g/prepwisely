import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type Department, useSaveDepartment } from "@/lib/structure";

interface DepartmentDialogProps {
  collegeId: string;
  /** null = closed; { department: null } = new department; { department } = renaming it. */
  state: { department: Department | null } | null;
  onClose: () => void;
}

export function DepartmentDialog({ collegeId, state, onClose }: DepartmentDialogProps) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {state && (
          <DepartmentForm key={state.department?.id ?? "new"} collegeId={collegeId} department={state.department} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DepartmentForm({ collegeId, department, onClose }: { collegeId: string; department: Department | null; onClose: () => void }) {
  const [code, setCode] = useState(department?.code ?? "");
  const [name, setName] = useState(department?.name ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const save = useSaveDepartment(collegeId);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    save.mutate(
      { id: department?.id, input: { code, name } },
      {
        onSuccess: () => {
          toast.success(department ? "Department updated." : "Department added.");
          onClose();
        },
        onError: (err) => setProblem(err.message),
      },
    );
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{department ? "Edit department" : "Add department"}</DialogTitle>
        <DialogDescription>
          {department ? "Update this department's name." : "Add a department to this college. Batches are added under it."}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3">
        <div className="grid grid-cols-[8rem_1fr] gap-1.5">
          <div className="grid gap-1.5">
            <Label htmlFor="department_code">Code</Label>
            {/* Set once: batch codes include it (e.g. SEC-CSE-2027-B01), so the database won't let it change. */}
            <Input
              id="department_code"
              value={code}
              maxLength={10}
              placeholder="e.g. CSE"
              disabled={department !== null}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="department_name">Department name</Label>
            <Input id="department_name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Computer Science and Engineering" />
          </div>
        </div>
        <p className="-mt-1.5 text-xs text-muted-foreground">
          {department
            ? "The department code can't be changed."
            : "Code: 2–10 letters or digits, unique within this college. It can't be changed later."}
        </p>
      </div>

      {problem && <p className="text-xs text-destructive">{problem}</p>}

      <DialogFooter>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : department ? "Save changes" : "Add department"}
        </Button>
      </DialogFooter>
    </form>
  );
}
