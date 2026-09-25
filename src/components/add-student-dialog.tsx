import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { batchPassword, useAddStudent } from "@/lib/students";

interface AddStudentDialogProps {
  open: boolean;
  batchId: string;
  batchCode: string;
  collegeId: string;
  onClose: () => void;
}

export function AddStudentDialog({ open, batchId, batchCode, collegeId, onClose }: AddStudentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>{open && <AddStudentForm batchId={batchId} batchCode={batchCode} collegeId={collegeId} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function AddStudentForm({ batchId, batchCode, collegeId, onClose }: Omit<AddStudentDialogProps, "open">) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [rollNumber, setRollNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const add = useAddStudent(batchId, collegeId);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    add.mutate(
      { full_name: fullName, email, roll_number: rollNumber, phone },
      {
        onSuccess: () => {
          toast.success(`Student added. They sign in with their email and ${batchPassword(batchCode)}.`);
          onClose();
        },
        onError: (err) => setProblem(err.message),
      },
    );
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Add student to {batchCode}</DialogTitle>
        <DialogDescription>
          The student signs in with their email. Their first password is the batch code without dashes,{" "}
          <span className="font-medium text-foreground">{batchPassword(batchCode)}</span>; they can change it later.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="student_name">Full name</Label>
          <Input id="student_name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="student_email">Email</Label>
          <Input id="student_email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <div className="grid gap-1.5">
            <Label htmlFor="student_roll">Roll number</Label>
            <Input id="student_roll" value={rollNumber} maxLength={30} onChange={(e) => setRollNumber(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="student_phone">
              Phone <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input id="student_phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
        <p className="-mt-1.5 text-xs text-muted-foreground">
          Roll number: unique in this college.
        </p>
      </div>

      {problem && <p className="text-xs text-destructive">{problem}</p>}

      <DialogFooter>
        <Button type="submit" disabled={add.isPending}>
          {add.isPending ? "Adding…" : "Add student"}
        </Button>
      </DialogFooter>
    </form>
  );
}
