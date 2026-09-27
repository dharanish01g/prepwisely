import { type FormEvent, useState } from "react";
import { CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { copyText, PasswordField } from "@/components/password-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type Faculty, type FacultyRole, generatePassword, useAddFaculty, useUpdateFaculty } from "@/lib/faculty";
import type { Department } from "@/lib/structure";

// Add or edit one faculty member. Adding sets a generated password (editable) and ends on a screen with the new
// faculty ID, email and password to hand over, since the password isn't shown again. Editing changes name, phone,
// department and current role; email and faculty ID are locked.

const NONE = "none";

export type FacultyDialogState = { faculty: Faculty | null } | null;

interface FacultyDialogProps {
  state: FacultyDialogState;
  collegeId: string;
  collegeCode: string;
  departments: Department[];
  roles: FacultyRole[];
  onClose: () => void;
}

export function FacultyDialog({ state, ...props }: FacultyDialogProps) {
  return (
    <Dialog open={state !== null} onOpenChange={(next) => !next && props.onClose()}>
      <DialogContent>{state && <FacultyForm key={state.faculty?.id ?? "new"} faculty={state.faculty} {...props} />}</DialogContent>
    </Dialog>
  );
}

/** The sign-in details to hand a faculty member, with a button that copies them all at once. */
export function FacultyCredentials({ code, email, password }: { code: string; email: string; password: string }) {
  const rows = [
    ["Faculty ID", code],
    ["Email", email],
    ["Password", password],
  ];
  return (
    <div className="grid gap-3 border p-4">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[6rem_1fr] items-baseline gap-2">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`text-sm break-all ${label === "Password" ? "font-mono" : ""}`}>{value}</p>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="justify-self-start"
        onClick={() => void copyText(rows.map(([label, value]) => `${label}: ${value}`).join("\n"), "Sign-in details copied")}
      >
        <CopyIcon />
        Copy all
      </Button>
    </div>
  );
}

function FacultyForm({ faculty, collegeId, collegeCode, departments, roles, onClose }: Omit<FacultyDialogProps, "state"> & { faculty: Faculty | null }) {
  const editing = faculty !== null;
  const [fullName, setFullName] = useState(faculty?.full_name ?? "");
  const [email, setEmail] = useState(faculty?.email ?? "");
  const [phone, setPhone] = useState(faculty?.phone ?? "");
  const [departmentId, setDepartmentId] = useState(faculty?.department_id ?? NONE);
  const [roleId, setRoleId] = useState(faculty?.faculty_role_id ?? NONE);
  const [password, setPassword] = useState(generatePassword);
  const [problem, setProblem] = useState<string | null>(null);
  const [created, setCreated] = useState<{ code: string; email: string; password: string } | null>(null);
  const add = useAddFaculty(collegeId);
  const update = useUpdateFaculty(collegeId);
  const pending = add.isPending || update.isPending;

  // Archived departments and retired roles can't be picked, but one already set stays selectable so an edit keeps it.
  const departmentItems = [
    { value: NONE, label: "No department" },
    ...departments
      .filter((d) => !d.archived_at || d.id === faculty?.department_id)
      .map((d) => ({ value: d.id, label: `${d.code} · ${d.name}${d.archived_at ? " (archived)" : ""}` })),
  ];
  const roleItems = [
    { value: NONE, label: "No role" },
    ...roles.filter((r) => r.is_active || r.id === faculty?.faculty_role_id).map((r) => ({ value: r.id, label: r.label })),
  ];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    const input = {
      full_name: fullName,
      email,
      phone,
      department_id: departmentId === NONE ? null : departmentId,
      faculty_role_id: roleId === NONE ? null : roleId,
    };
    if (editing) {
      update.mutate(
        { facultyId: faculty.id, input },
        {
          onSuccess: () => {
            toast.success("Faculty details saved.");
            onClose();
          },
          onError: (err) => setProblem(err.message),
        },
      );
    } else {
      add.mutate(
        { input, password },
        {
          onSuccess: (code) => setCreated({ code, email: email.trim().toLowerCase(), password }),
          onError: (err) => setProblem(err.message),
        },
      );
    }
  }

  if (created) {
    return (
      <div className="flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Faculty added</DialogTitle>
          <DialogDescription>
            Hand these sign-in details to {fullName.trim()}. The password isn't shown again; if it's lost, reset it from their
            details.
          </DialogDescription>
        </DialogHeader>
        <FacultyCredentials {...created} />
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{editing ? `Edit ${faculty.code}` : `Add faculty to ${collegeCode}`}</DialogTitle>
        <DialogDescription>
          {editing
            ? "Email and faculty ID can't be changed."
            : "They sign in with their email. A faculty ID is created for them when you save."}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="faculty_name">Full name</Label>
          <Input id="faculty_name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="faculty_email">Email</Label>
            <Input id="faculty_email" type="email" value={email} disabled={editing} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="faculty_phone">
              Phone <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input id="faculty_phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="faculty_department">
              Department <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Select value={departmentId} onValueChange={(v) => setDepartmentId(v ?? NONE)} items={departmentItems}>
              <SelectTrigger id="faculty_department" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {departmentItems.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="faculty_role">
              Current role <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Select value={roleId} onValueChange={(v) => setRoleId(v ?? NONE)} items={roleItems}>
              <SelectTrigger id="faculty_role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleItems.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {!editing && (
          <div className="grid gap-1.5">
            <Label htmlFor="faculty_password">Password</Label>
            <PasswordField id="faculty_password" value={password} onChange={setPassword} />
            <p className="text-xs text-muted-foreground">Generated for you; at least 8 characters if you type your own.</p>
          </div>
        )}
      </div>

      {problem && <p className="text-xs text-destructive">{problem}</p>}

      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save" : "Add faculty"}
        </Button>
      </DialogFooter>
    </form>
  );
}
