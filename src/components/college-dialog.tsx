import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CONTACT_PREFIXES, type College, useSaveCollege } from "@/lib/colleges";

interface CollegeDialogProps {
  /** null = closed; { college: null } = new college; { college } = editing contact details. */
  state: { college: College | null } | null;
  onClose: () => void;
}

export function CollegeDialog({ state, onClose }: CollegeDialogProps) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {state && <CollegeForm key={state.college?.id ?? "new"} college={state.college} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

const PREFIX_ITEMS = CONTACT_PREFIXES.map((p) => ({ value: p, label: p }));

function CollegeForm({ college, onClose }: { college: College | null; onClose: () => void }) {
  const [name, setName] = useState(college?.name ?? "");
  const [code, setCode] = useState(college?.code ?? "");
  const [contactPrefix, setContactPrefix] = useState<string>(college?.contact_prefix ?? "");
  const [contactName, setContactName] = useState(college?.contact_name ?? "");
  const [contactEmail, setContactEmail] = useState(college?.contact_email ?? "");
  const [contactPhone, setContactPhone] = useState(college?.contact_phone ?? "");
  const [contactPhoneAlt, setContactPhoneAlt] = useState(college?.contact_phone_alt ?? "");
  const [city, setCity] = useState(college?.city ?? "");
  const [state, setState] = useState(college?.state ?? "");
  const [address, setAddress] = useState(college?.address ?? "");
  const [notes, setNotes] = useState(college?.notes ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const save = useSaveCollege();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    save.mutate(
      {
        id: college?.id,
        input: {
          name,
          code,
          contact_prefix: contactPrefix,
          contact_name: contactName,
          contact_email: contactEmail,
          contact_phone: contactPhone,
          contact_phone_alt: contactPhoneAlt,
          city,
          state,
          address,
          notes,
        },
      },
      {
        onSuccess: () => {
          toast.success(college ? "College updated." : "College created. You've been assigned to it.");
          onClose();
        },
        onError: (err) => setProblem(err.message),
      },
    );
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{college ? "Edit college" : "Add college"}</DialogTitle>
        <DialogDescription>
          {college ? "Update this college's contact details." : "Create a college record. You'll be assigned to it automatically."}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3">
        <div className="grid grid-cols-[1fr_8rem] gap-1.5">
          <div className="grid gap-1.5">
            <Label htmlFor="college_name">College name</Label>
            <Input id="college_name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="college_code">Code</Label>
            {/* Set once: batch codes start with it (e.g. SEC-CSE-2027-B01), so the database won't let it change. */}
            <Input
              id="college_code"
              value={code}
              maxLength={10}
              placeholder="e.g. SEC"
              disabled={college !== null}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </div>
        </div>
        <p className="-mt-1.5 text-xs text-muted-foreground">
          {college
            ? "The college code can't be changed."
            : "Code: 2–10 letters or digits, unique across all colleges. It can't be changed later."}
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          <div className="grid gap-1.5">
            <Label htmlFor="college_city">City</Label>
            <Input id="college_city" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="college_state">State</Label>
            <Input id="college_state" value={state} onChange={(e) => setState(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="college_address">Address</Label>
          <Textarea id="college_address" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className="grid grid-cols-[7rem_1fr] gap-1.5">
          <div className="grid gap-1.5">
            <Label htmlFor="college_contact_prefix">Prefix</Label>
            <Select value={contactPrefix} onValueChange={(v) => setContactPrefix(v ?? "")} items={PREFIX_ITEMS}>
              <SelectTrigger id="college_contact_prefix" className="w-full">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {PREFIX_ITEMS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="college_contact_name">Contact name</Label>
            <Input id="college_contact_name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="college_contact_email">Contact email</Label>
          <Input id="college_contact_email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <div className="grid gap-1.5">
            <Label htmlFor="college_contact_phone">Contact phone</Label>
            <Input id="college_contact_phone" type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="college_contact_phone_alt">Alternate phone</Label>
            <Input id="college_contact_phone_alt" type="tel" value={contactPhoneAlt} onChange={(e) => setContactPhoneAlt(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="college_notes">
            Notes <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id="college_notes"
            rows={3}
            maxLength={2000}
            placeholder="Anything else worth knowing about this college"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      {problem && <p className="text-xs text-destructive">{problem}</p>}

      <DialogFooter>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : college ? "Save changes" : "Create college"}
        </Button>
      </DialogFooter>
    </form>
  );
}
