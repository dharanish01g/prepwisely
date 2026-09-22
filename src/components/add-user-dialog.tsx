import { type FormEvent, useState } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useRoles } from "@/lib/roles";
import { createUser } from "@/lib/users";

const EMPTY = { full_name: "", email: "", password: "", role_id: "", phone: "", address: "" };

interface AddUserDialogProps {
  onCreated: () => void;
  /** Restricts the role dropdown to these role ids. Omit to offer every role (superadmin's User Management). */
  allowedRoleIds?: string[];
  triggerLabel?: string;
  title?: string;
  description?: string;
}

export function AddUserDialog({
  onCreated,
  allowedRoleIds,
  triggerLabel = "Add user",
  title = "Add user",
  description = "Create a staff account. Share the email and temporary password with them; they can change it after signing in.",
}: AddUserDialogProps) {
  const { roles: allRoles } = useRoles();
  const roles = allowedRoleIds ? allRoles.filter((r) => allowedRoleIds.includes(r.id)) : allRoles;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof EMPTY) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setForm(EMPTY);
      setError(null);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createUser(form);
      handleOpenChange(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" />}>
        <PlusIcon />
        {triggerLabel}
      </DialogTrigger>
      <DialogContent>
        <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="full_name">Full name</Label>
              <Input id="full_name" value={form.full_name} onChange={(e) => set("full_name")(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={form.email} onChange={(e) => set("email")(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="password">Temporary password</Label>
              <Input
                id="password"
                autoComplete="off"
                placeholder="At least 8 characters"
                value={form.password}
                onChange={(e) => set("password")(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="role">Role</Label>
              <Select
                value={form.role_id}
                onValueChange={(v) => set("role_id")(v ?? "")}
                items={roles.map((r) => ({ value: r.id, label: r.label }))}
              >
                <SelectTrigger id="role" className="w-full">
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
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="phone">Phone number</Label>
              <Input id="phone" type="tel" value={form.phone} onChange={(e) => set("phone")(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="address">Address</Label>
              <Textarea id="address" rows={2} value={form.address} onChange={(e) => set("address")(e.target.value)} />
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={submitting || !form.role_id}>
              {submitting ? "Creating…" : "Create user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
