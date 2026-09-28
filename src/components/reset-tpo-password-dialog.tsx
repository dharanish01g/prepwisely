import { type FormEvent, useState } from "react";
import { FacultyCredentials } from "@/components/faculty-dialog";
import { PasswordField } from "@/components/password-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { generatePassword } from "@/lib/faculty";
import { type Tpo, useResetTpoPassword } from "@/lib/tpo";

interface ResetTpoPasswordDialogProps {
  tpo: Tpo | null;
  /** Set when the TPO is also faculty: they have one login, so this resets their faculty sign-in too. */
  alsoFaculty: boolean;
  onClose: () => void;
}

/** Sets a new (generated, editable) password and shows the sign-in details to hand over once. */
export function ResetTpoPasswordDialog({ tpo, alsoFaculty, onClose }: ResetTpoPasswordDialogProps) {
  return (
    <Dialog open={tpo !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>{tpo && <ResetForm key={tpo.id} tpo={tpo} alsoFaculty={alsoFaculty} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function ResetForm({ tpo, alsoFaculty, onClose }: { tpo: Tpo; alsoFaculty: boolean; onClose: () => void }) {
  const [password, setPassword] = useState(generatePassword);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const reset = useResetTpoPassword();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    reset.mutate({ tpoId: tpo.id, password }, { onSuccess: () => setDone(true), onError: (err) => setProblem(err.message) });
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Password reset</DialogTitle>
          <DialogDescription>Hand the new sign-in details to {tpo.full_name}. The password isn't shown again.</DialogDescription>
        </DialogHeader>
        <FacultyCredentials code={tpo.code} email={tpo.email} password={password} idLabel="TPO ID" />
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
          Set a new password for {tpo.full_name} ({tpo.email}). Their current password stops working immediately
          {alsoFaculty ? ", for both their faculty and TPO sign-in (it's one account)." : "."}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor="tpo_reset_password">New password</Label>
        <PasswordField id="tpo_reset_password" value={password} onChange={setPassword} />
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
