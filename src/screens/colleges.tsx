import { useMemo, useState } from "react";
import { ChevronRightIcon, PlusIcon, SearchIcon } from "lucide-react";
import { CollegeDialog } from "@/components/college-dialog";
import { CollegeStatusButton } from "@/components/college-status-button";
import { RefreshButton } from "@/components/refresh-button";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type College, useColleges } from "@/lib/colleges";
import { useIsSuperadmin } from "@/lib/roles";

export function CollegesScreen() {
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ college: College | null } | null>(null);
  const { data: colleges = [], isPending, isFetching, error, refetch } = useColleges();
  const { isSuperadmin } = useIsSuperadmin();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return colleges;
    return colleges.filter((c) =>
      [c.name, c.code, c.city ?? "", c.state ?? "", c.address ?? "", c.contact_name ?? "", c.contact_email ?? "", c.contact_phone ?? "", c.contact_phone_alt ?? ""].some(
        (v) => v.toLowerCase().includes(q),
      ),
    );
  }, [colleges, query]);

  const open = openId ? colleges.find((c) => c.id === openId) : undefined;

  return (
    <>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">{isSuperadmin ? "Colleges" : "My colleges"}</h1>
              <p className="text-sm text-muted-foreground">
                {isSuperadmin ? "Every client college on the platform." : "The colleges you're onboarding and responsible for."}
              </p>
            </div>
            <div className="flex gap-2">
              <RefreshButton onRefresh={() => void refetch()} refreshing={isFetching} />
              <Button size="sm" onClick={() => setDialog({ college: null })}>
                <PlusIcon />
                Add college
              </Button>
            </div>
          </div>

          <div className="relative max-w-sm">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search by name, code or contact" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
          </div>

          <div className="border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Code</TableHead>
                  <TableHead>College</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Status</TableHead>
                  {isSuperadmin && <TableHead>Active</TableHead>}
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isPending ? (
                  <TableSkeletonRows columns={isSuperadmin ? ["w-12", "w-48", "w-56", "w-16", "w-10", "w-6"] : ["w-12", "w-48", "w-56", "w-16", "w-6"]} />
                ) : error || filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={isSuperadmin ? 6 : 5} className={`h-24 text-center ${error ? "text-destructive" : "text-muted-foreground"}`}>
                      {error ? `Could not load colleges: ${error.message}` : colleges.length === 0 ? "No colleges yet. Add one to get started." : "No colleges match."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((c) => (
                    <TableRow key={c.id} className="cursor-pointer" onClick={() => setOpenId(c.id)}>
                      <TableCell className="font-medium">{c.code}</TableCell>
                      <TableCell className="max-w-48 font-medium">
                        <div className="flex flex-col">
                          <span className="truncate">{c.name}</span>
                          {(c.city || c.state) && (
                            <span className="truncate font-normal text-muted-foreground">{[c.city, c.state].filter(Boolean).join(", ")}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-56 text-muted-foreground">
                        {c.contact_name || c.contact_email || c.contact_phone || c.contact_phone_alt ? (
                          <div className="flex flex-col">
                            {c.contact_name && (
                              <span className="truncate text-foreground">
                                {c.contact_prefix ? `${c.contact_prefix} ` : ""}
                                {c.contact_name}
                              </span>
                            )}
                            {c.contact_email && <span className="truncate">{c.contact_email}</span>}
                            {(c.contact_phone || c.contact_phone_alt) && (
                              <span className="truncate">{[c.contact_phone, c.contact_phone_alt].filter(Boolean).join(" / ")}</span>
                            )}
                          </div>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={c.status === "active" ? "default" : "secondary"} className="capitalize">
                          {c.status}
                        </Badge>
                      </TableCell>
                      {isSuperadmin && (
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <CollegeStatusButton college={c} />
                        </TableCell>
                      )}
                      <TableCell>
                        <ChevronRightIcon className="size-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

      <Sheet open={open !== undefined} onOpenChange={(next) => !next && setOpenId(null)}>
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          {open && (
            <CollegeDetails college={open} isSuperadmin={isSuperadmin} onEdit={() => setDialog({ college: open })} />
          )}
        </SheetContent>
      </Sheet>

      <CollegeDialog state={dialog} onClose={() => setDialog(null)} />
    </>
  );
}

function Field({ label, value, full = false }: { label: string; value: string | null | undefined; full?: boolean }) {
  if (!value) return null;
  return (
    <div className={`grid gap-0.5 ${full ? "col-span-2" : ""}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm break-all">{value}</p>
    </div>
  );
}

function CollegeDetails({
  college,
  isSuperadmin,
  onEdit,
}: {
  college: College;
  isSuperadmin: boolean;
  onEdit: () => void;
}) {
  const contactFullName = college.contact_name
    ? `${college.contact_prefix ? `${college.contact_prefix} ` : ""}${college.contact_name}`
    : null;

  return (
    <div className="flex flex-1 flex-col gap-5">
      <SheetHeader>
        <SheetTitle className="text-lg font-semibold break-words">{college.name}</SheetTitle>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-5 px-4 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{college.code}</Badge>
            <Badge variant={college.status === "active" ? "default" : "secondary"} className="capitalize">
              {college.status}
            </Badge>
            {[college.city, college.state].filter(Boolean).length > 0 && <span>{[college.city, college.state].filter(Boolean).join(", ")}</span>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isSuperadmin && <CollegeStatusButton college={college} />}
            <Button variant="outline" size="sm" onClick={onEdit}>
              Edit
            </Button>
          </div>
        </div>

        <div className="grid gap-4 border p-4">
          <h2 className="text-sm font-semibold">Location</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="City" value={college.city} />
            <Field label="State" value={college.state} />
            <Field label="Address" value={college.address} full />
          </div>
          {!college.city && !college.state && !college.address && <p className="text-sm text-muted-foreground">No location on file.</p>}
        </div>

        <div className="grid gap-4 border p-4">
          <h2 className="text-sm font-semibold">Contact</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name" value={contactFullName} />
            <Field label="Phone" value={college.contact_phone} />
            <Field label="Alternate phone" value={college.contact_phone_alt} />
            <Field label="Email" value={college.contact_email} full />
            <Field label="Joined on" value={new Date(college.created_at).toLocaleDateString()} />
          </div>
          {!contactFullName && !college.contact_email && !college.contact_phone && !college.contact_phone_alt && (
            <p className="text-sm text-muted-foreground">No contact details on file.</p>
          )}
        </div>

        <div className="grid gap-2 border p-4">
          <h2 className="text-sm font-semibold">Notes</h2>
          {college.notes ? (
            <p className="text-sm break-words whitespace-pre-wrap">{college.notes}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No notes.</p>
          )}
        </div>
      </div>
    </div>
  );
}
