import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type Department, useAddBatch } from "@/lib/structure";

interface BatchDialogProps {
  collegeId: string;
  /** null = closed; otherwise the department the new batch goes into. */
  department: Department | null;
  onClose: () => void;
}

export function BatchDialog({ collegeId, department, onClose }: BatchDialogProps) {
  return (
    <Dialog open={department !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>{department && <BatchForm collegeId={collegeId} department={department} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function BatchForm({ collegeId, department, onClose }: { collegeId: string; department: Department; onClose: () => void }) {
  const [year, setYear] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const add = useAddBatch(collegeId);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    add.mutate(
      { departmentId: department.id, graduationYear: year },
      {
        onSuccess: () => {
          toast.success("Batch added.");
          onClose();
        },
        onError: (err) => setProblem(err.message),
      },
    );
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Add batch to {department.code}</DialogTitle>
        <DialogDescription>
          A batch is one section of a year's intake. Its code is generated from the year: the first 2027 batch ends in
          {` ${department.code}-2027-B01`}, the next in B02, and each year starts again at B01.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor="batch_year">Graduation year</Label>
        <Input
          id="batch_year"
          inputMode="numeric"
          maxLength={4}
          placeholder={`e.g. ${new Date().getFullYear() + 1}`}
          value={year}
          onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))}
          className="w-32"
        />
        <p className="text-xs text-muted-foreground">The year this batch finishes. It can't be changed later.</p>
      </div>

      {problem && <p className="text-xs text-destructive">{problem}</p>}

      <DialogFooter>
        <Button type="submit" disabled={add.isPending}>
          {add.isPending ? "Saving…" : "Add batch"}
        </Button>
      </DialogFooter>
    </form>
  );
}
