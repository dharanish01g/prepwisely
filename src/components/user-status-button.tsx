import { useState } from "react";
import { Loader2Icon, UserCheckIcon, UserXIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { type StaffUser, setUserStatus } from "@/lib/users";

/** Deactivates or reactivates an account in one click, mirroring the archive/restore toggle on questions. */
export function UserStatusButton({ user, onChanged }: { user: StaffUser; onChanged: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const activate = user.status === "inactive";

  async function handleClick() {
    setSubmitting(true);
    try {
      await setUserStatus(user.id, activate ? "active" : "inactive");
      toast.success(`${activate ? "Reactivated" : "Deactivated"} ${user.full_name}.`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`${activate ? "Reactivate" : "Deactivate"} ${user.full_name}`}
      onClick={handleClick}
      disabled={submitting}
    >
      {submitting ? <Loader2Icon className="animate-spin" /> : activate ? <UserCheckIcon /> : <UserXIcon />}
    </Button>
  );
}
