import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useRoles } from "@/lib/roles";
import { type StaffUser, updateUser } from "@/lib/users";

interface EditUserDialogProps {
  user: StaffUser | null;
  onClose: () => void;
  onSaved: () => void;
  /** Restricts the role dropdown to these role ids. Omit to offer every role (superadmin's User Management). */
  allowedRoleIds?: string[];
}

export function EditUserDialog({ user, onClose, onSaved, allowedRoleIds }: EditUserDialogProps) {
  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {/* Keyed by user so the form state resets when a different user is opened. */}
        {user && <EditUserForm key={user.id} user={user} onSaved={onSaved} onClose={onClose} allowedRoleIds={allowedRoleIds} />}
      </DialogContent>
    </Dialog>
  );
}

function EditUserForm({
  user,
  onSaved,
  onClose,
  allowedRoleIds,
}: {
  user: StaffUser;
  onSaved: () => void;
  onClose: () => void;
  allowedRoleIds?: string[];
}) {
  const [fullName, setFullName] = useState(user.full_name);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [address, setAddress] = useState(user.address ?? "");
  // Users hold one role in the UI; if one somehow has several, none is preselected until a choice is made.
  const currentRole = user.roles.length === 1 ? user.roles[0] : "";
  const [roleId, setRoleId] = useState(currentRole);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { user: me } = useAuth();
  const { roles: allRoles } = useRoles();
  const roles = allowedRoleIds ? allRoles.filter((r) => allowedRoleIds.includes(r.id)) : allRoles;
  const isSelf = me?.id === user.id;
  const roleChanged = roleId !== "" && roleId !== currentRole;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await updateUser(user.id, { full_name: fullName, phone, address, ...(roleChanged ? { role_id: roleId } : {}) });
      onClose();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Edit user</DialogTitle>
        <DialogDescription>Update details for {user.email}. Email can't be changed here.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="edit_full_name">Full name</Label>
          <Input id="edit_full_name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="edit_role">Role</Label>
          <Select
            value={roleId}
            onValueChange={(v) => setRoleId(v ?? "")}
            items={roles.map((r) => ({ value: r.id, label: r.label }))}
            disabled={isSelf}
          >
            <SelectTrigger id="edit_role" className="w-full">
              <SelectValue placeholder="Select a role" />
            </SelectTrigger>
            <SelectContent>
              {roles.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isSelf ? (
            <p className="text-xs text-muted-foreground">You can't change your own role.</p>
          ) : (
            roleChanged && (
              <p className="text-xs text-muted-foreground">
                The new role applies immediately. Anything they created under the old role stays, but they may no longer be able to edit it.
              </p>
            )
          )}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="edit_phone">Phone number</Label>
          <Input id="edit_phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="edit_address">Address</Label>
          <Textarea id="edit_address" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <DialogFooter>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}
