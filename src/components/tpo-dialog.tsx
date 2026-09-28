import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { FacultyCredentials } from "@/components/faculty-dialog";
import { PasswordField } from "@/components/password-field";
import { Button } from "@/components/ui/button";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type Faculty, generatePassword } from "@/lib/faculty";
import { type Tpo, type TpoDesignation, useAddTpo, useAddTpoFromFaculty, useUpdateTpo } from "@/lib/tpo";

// Add or edit one TPO. "new" creates a login with a generated password (editable) and ends on a screen with the TPO
// ID, email and password to hand over. "faculty" makes an existing faculty member of the college a TPO: no new login
// or password, they sign in as before and get both roles. Editing changes name, phone and designation; email and TPO
// ID are locked (for a faculty member, name and phone change on their faculty record too).

const NONE = "none";

export type TpoDialogState = { mode: "new" } | { mode: "faculty" } | { mode: "edit"; tpo: Tpo } | null;

interface TpoDialogProps {
  state: TpoDialogState;
  collegeId: string;
  collegeCode: string;
  designations: TpoDesignation[];
  /** Active faculty of the college who aren't a TPO yet (for "faculty" mode). */
  eligibleFaculty: Faculty[];
  /** Faculty ID of the person when they are also faculty (edit mode). */
  facultyCode?: string;
  onClose: () => void;
}

export function TpoDialog({ state, ...props }: TpoDialogProps) {
  const key = state?.mode === "edit" ? state.tpo.id : state?.mode;
  return (
    <Dialog open={state !== null} onOpenChange={(next) => !next && props.onClose()}>
      <DialogContent>
        {state?.mode === "faculty" ? (
          <FromFacultyForm key={key} {...props} />
        ) : state ? (
          <TpoForm key={key} tpo={state.mode === "edit" ? state.tpo : null} {...props} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DesignationSelect({ id, value, onChange, items }: { id: string; value: string; onChange: (v: string) => void; items: { value: string; label: string }[] }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? NONE)} items={items}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((d) => (
          <SelectItem key={d.value} value={d.value}>
            {d.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Retired designations can't be picked, but one already set stays selectable so an edit keeps it.
function designationItems(designations: TpoDesignation[], keepId: string | null) {
  return [
    { value: NONE, label: "No designation" },
    ...designations.filter((d) => d.is_active || d.id === keepId).map((d) => ({ value: d.id, label: d.label })),
  ];
}

function TpoForm({ tpo, collegeId, collegeCode, designations, facultyCode, onClose }: Omit<TpoDialogProps, "state"> & { tpo: Tpo | null }) {
  const editing = tpo !== null;
  const [fullName, setFullName] = useState(tpo?.full_name ?? "");
  const [email, setEmail] = useState(tpo?.email ?? "");
  const [phone, setPhone] = useState(tpo?.phone ?? "");
  const [designationId, setDesignationId] = useState(tpo?.designation_id ?? NONE);
  const [password, setPassword] = useState(generatePassword);
  const [problem, setProblem] = useState<string | null>(null);
  const [created, setCreated] = useState<{ code: string; email: string; password: string } | null>(null);
  const add = useAddTpo(collegeId);
  const update = useUpdateTpo(collegeId);
  const pending = add.isPending || update.isPending;
  const items = designationItems(designations, tpo?.designation_id ?? null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    const input = { full_name: fullName, email, phone, designation_id: designationId === NONE ? null : designationId };
    if (editing) {
      update.mutate(
        { tpoId: tpo.id, input },
        {
          onSuccess: () => {
            toast.success("TPO details saved.");
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
          <DialogTitle>TPO added</DialogTitle>
          <DialogDescription>
            Hand these sign-in details to {fullName.trim()}. The password isn't shown again; if it's lost, reset it from their
            details.
          </DialogDescription>
        </DialogHeader>
        <FacultyCredentials {...created} idLabel="TPO ID" />
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{editing ? `Edit ${tpo.code}` : `Add TPO to ${collegeCode}`}</DialogTitle>
        <DialogDescription>
          {editing
            ? facultyCode
              ? `Email and TPO ID can't be changed. Name and phone also change on their faculty record (${facultyCode}).`
              : "Email and TPO ID can't be changed."
            : "A new sign-in for someone who isn't faculty here. A TPO ID is created for them when you save."}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="tpo_name">Full name</Label>
          <Input id="tpo_name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="tpo_email">Email</Label>
            <Input id="tpo_email" type="email" value={email} disabled={editing} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="tpo_phone">
              Phone <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input id="tpo_phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="tpo_designation">
            Designation <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <DesignationSelect id="tpo_designation" value={designationId} onChange={setDesignationId} items={items} />
        </div>
        {!editing && (
          <div className="grid gap-1.5">
            <Label htmlFor="tpo_password">Password</Label>
            <PasswordField id="tpo_password" value={password} onChange={setPassword} />
            <p className="text-xs text-muted-foreground">Generated for you; at least 8 characters if you type your own.</p>
          </div>
        )}
      </div>

      {problem && <p className="text-xs text-destructive">{problem}</p>}

      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save" : "Add TPO"}
        </Button>
      </DialogFooter>
    </form>
  );
}

const facultyLabel = (f: Faculty) => `${f.code} · ${f.full_name}`;

function FromFacultyForm({ collegeId, collegeCode, designations, eligibleFaculty, onClose }: Omit<TpoDialogProps, "state">) {
  const [picked, setPicked] = useState<Faculty | null>(null);
  const [designationId, setDesignationId] = useState(NONE);
  const [problem, setProblem] = useState<string | null>(null);
  const add = useAddTpoFromFaculty(collegeId);
  const items = designationItems(designations, null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    if (!picked) {
      setProblem("Pick a faculty member");
      return;
    }
    add.mutate(
      { facultyId: picked.id, designationId: designationId === NONE ? null : designationId },
      {
        onSuccess: (code) => {
          toast.success(`${picked.full_name} is now a TPO (${code}). They sign in as before and can switch between Faculty and TPO.`);
          onClose();
        },
        onError: (err) => setProblem(err.message),
      },
    );
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{`Add TPO from ${collegeCode} faculty`}</DialogTitle>
        <DialogDescription>
          They keep their faculty sign-in and password, and get the TPO role on the same account. A TPO ID is created for
          them when you save.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="tpo_faculty">Faculty member</Label>
          <Combobox
            items={eligibleFaculty}
            value={picked}
            onValueChange={(f: Faculty | null) => setPicked(f)}
            itemToStringLabel={facultyLabel}
            isItemEqualToValue={(a: Faculty, b: Faculty) => a.id === b.id}
            filter={(f: Faculty, query: string) => {
              const q = query.trim().toLowerCase();
              // The input shows the picked member's label; treat that as "no search" so the full list opens.
              if (!q || (picked && q === facultyLabel(picked).toLowerCase())) return true;
              return [f.code, f.full_name, f.email].some((v) => v.toLowerCase().includes(q));
            }}
          >
            <ComboboxInput id="tpo_faculty" placeholder="Search by ID, name or email" className="w-full" />
            <ComboboxContent>
              <ComboboxEmpty>
                {eligibleFaculty.length ? "No faculty match." : "No active faculty left to add (already TPOs or inactive)."}
              </ComboboxEmpty>
              <ComboboxList>
                {(f: Faculty) => (
                  <ComboboxItem key={f.id} value={f}>
                    <span className="w-20 shrink-0 font-medium">{f.code}</span>
                    <span className="truncate">{f.full_name}</span>
                    <span className="ml-auto shrink-0 truncate text-muted-foreground">{f.email}</span>
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="tpo_faculty_designation">
            Designation <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <DesignationSelect id="tpo_faculty_designation" value={designationId} onChange={setDesignationId} items={items} />
        </div>
      </div>

      {problem && <p className="text-xs text-destructive">{problem}</p>}

      <DialogFooter>
        <Button type="submit" disabled={add.isPending}>
          {add.isPending ? "Saving…" : "Make TPO"}
        </Button>
      </DialogFooter>
    </form>
  );
}
