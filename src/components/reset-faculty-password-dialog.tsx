import { type FormEvent, useState } from "react";
import { FacultyCredentials } from "@/components/faculty-dialog";
import { PasswordField } from "@/components/password-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { type Faculty, generatePassword, useResetFacultyPassword } from "@/lib/faculty";

interface ResetFacultyPasswordDialogProps {
  faculty: Faculty | null;
  onClose: () => void;
}

/** Sets a new (generated, editable) password and shows the sign-in details to hand over once. */
export function ResetFacultyPasswordDialog({ faculty, onClose }: ResetFacultyPasswordDialogProps) {
  return (
    <Dialog open={faculty !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>{faculty && <ResetForm key={faculty.id} faculty={faculty} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function ResetForm({ faculty, onClose }: { faculty: Faculty; onClose: () => void }) {
  const [password, setPassword] = useState(generatePassword);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const reset = useResetFacultyPassword();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    reset.mutate({ facultyId: faculty.id, password }, { onSuccess: () => setDone(true), onError: (err) => setProblem(err.message) });
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Password reset</DialogTitle>
          <DialogDescription>Hand the new sign-in details to {faculty.full_name}. The password isn't shown again.</DialogDescription>
        </DialogHeader>
        <FacultyCredentials code={faculty.code} email={faculty.email} password={password} />
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Reset password</DialogTitle>
        <DialogDescription>
          Set a new password for {faculty.full_name} ({faculty.email}). Their current password stops working immediately.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor="faculty_reset_password">New password</Label>
        <PasswordField id="faculty_reset_password" value={password} onChange={setPassword} />
        <p className="text-xs text-muted-foreground">Generated for you; at least 8 characters if you type your own.</p>
      </div>

      {problem && <p className="text-xs text-destructive">{problem}</p>}

      <DialogFooter>
        <Button type="submit" disabled={reset.isPending}>
          {reset.isPending ? "Resetting…" : "Reset password"}
        </Button>
      </DialogFooter>
    </form>
  );
}
