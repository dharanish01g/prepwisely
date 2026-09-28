import { useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";
import { FilterSelect } from "@/components/filter-select";
import { Pager } from "@/components/pager";
import { RefreshButton } from "@/components/refresh-button";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDebounced } from "@/hooks/use-debounced";
import { useColleges } from "@/lib/colleges";
import { useBatches, useDepartments } from "@/lib/structure";
import { COLLEGE_STUDENTS_PAGE_SIZE, type CollegeStudentFilters, type Student, useCollegeStudents } from "@/lib/students";
import { StudentDetails } from "@/screens/batch-students";

// The TPO's Students page: every student of their college (RLS limits a TPO to their own), searched by name, email,
// roll number or phone and filtered by department, batch and status, all on the server. Read-only: a row opens the
// student's details. Their results and analytics will live here once students take tests.

const ALL = "all";

const STATUS_ITEMS = [
  { value: ALL, label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

export function CollegeStudentsScreen() {
  const { data: colleges = [], isPending: collegesPending } = useColleges();
  const college = colleges[0] ?? null;
  const collegeId = college?.id ?? null;
  const departments = useDepartments(collegeId);
  const batches = useBatches(collegeId);

  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState(ALL);
  const [batchId, setBatchId] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [page, setPage] = useState(0);
  // The student whose details drawer is open (kept as a row, so paging on doesn't close it).
  const [open, setOpen] = useState<Student | null>(null);
  const debouncedSearch = useDebounced(search);

  const departmentById = useMemo(() => new Map((departments.data ?? []).map((d) => [d.id, d])), [departments.data]);
  const batchById = useMemo(() => new Map((batches.data ?? []).map((b) => [b.id, b])), [batches.data]);
  const departmentBatches = useMemo(
    () => (batches.data ?? []).filter((b) => departmentId === ALL || b.department_id === departmentId),
    [batches.data, departmentId],
  );

  const filters = useMemo<CollegeStudentFilters>(
    () => ({
      search: debouncedSearch,
      batchIds: batchId !== ALL ? [batchId] : departmentId !== ALL ? departmentBatches.map((b) => b.id) : null,
      status: status as CollegeStudentFilters["status"],
      page,
    }),
    [debouncedSearch, batchId, departmentId, departmentBatches, status, page],
  );
  const students = useCollegeStudents(collegeId, filters);
  const rows = students.data?.rows ?? [];
  const total = students.data?.total ?? 0;
  const openBatch = open ? batchById.get(open.batch_id) : undefined;
  const openDepartment = openBatch ? departmentById.get(openBatch.department_id) : undefined;

  // A change of filter always goes back to the first page.
  const filter = (set: (value: string) => void) => (value: string) => {
    set(value);
    setPage(0);
  };

  const departmentItems = [
    { value: ALL, label: "All departments" },
    ...(departments.data ?? []).map((d) => ({ value: d.id, label: `${d.code} · ${d.name}${d.archived_at ? " (archived)" : ""}` })),
  ];
  const batchItems = [
    { value: ALL, label: "All batches" },
    ...departmentBatches.map((b) => ({ value: b.id, label: `${b.code}${b.archived_at ? " (archived)" : ""}` })),
  ];

  const loading = collegesPending || students.isPending || departments.isPending || batches.isPending;
  const loadError = students.error ?? departments.error ?? batches.error;
  const filtered = debouncedSearch.trim() !== "" || departmentId !== ALL || batchId !== ALL || status !== ALL;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Students</h1>
          <p className="text-sm text-muted-foreground">Look up any student of {college?.name ?? "your college"}.</p>
        </div>
        <RefreshButton
          onRefresh={() => {
            void students.refetch();
            void departments.refetch();
            void batches.refetch();
          }}
          refreshing={students.isFetching || departments.isFetching || batches.isFetching}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name, email, roll number or phone"
            value={search}
            onChange={(e) => filter(setSearch)(e.target.value)}
            className="pl-8"
          />
        </div>
        <FilterSelect
          aria-label="Department"
          value={departmentId}
          items={departmentItems}
          onChange={(v) => {
            filter(setDepartmentId)(v);
            setBatchId(ALL);
          }}
          className="w-56"
        />
        <FilterSelect aria-label="Batch" value={batchId} items={batchItems} onChange={filter(setBatchId)} className="w-52" />
        <FilterSelect aria-label="Status" value={status} items={STATUS_ITEMS} onChange={filter(setStatus)} />
      </div>

      <div className="border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">Roll number</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="w-44">Batch</TableHead>
              <TableHead className="w-24">Department</TableHead>
              <TableHead className="w-24">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableSkeletonRows columns={["w-20", "w-32", "w-44", "w-32", "w-12", "w-14"]} />
            ) : !college || loadError || rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className={`h-24 text-center ${loadError || !college ? "text-destructive" : "text-muted-foreground"}`}>
                  {!college
                    ? "Couldn't find your college. Contact support."
                    : loadError
                      ? `Could not load students: ${loadError.message}`
                      : filtered
                        ? "No students match."
                        : "No students yet."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((s) => {
                const batch = batchById.get(s.batch_id);
                return (
                  <TableRow
                    key={s.id}
                    className="cursor-pointer"
                    onClick={() => setOpen(s)}
                  >
                    <TableCell className="font-medium">{s.roll_number}</TableCell>
                    <TableCell className="max-w-48 truncate">{s.full_name}</TableCell>
                    <TableCell className="max-w-56 truncate text-muted-foreground">{s.email}</TableCell>
                    <TableCell>{batch?.code ?? "—"}</TableCell>
                    <TableCell>{(batch && departmentById.get(batch.department_id)?.code) ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={s.status === "active" ? "default" : "secondary"}>{s.status}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Pager page={page} pageSize={COLLEGE_STUDENTS_PAGE_SIZE} total={total} onPage={setPage} disabled={students.isFetching} />

      <Sheet open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          {open && openBatch && openDepartment && collegeId && (
            <StudentDetails student={open} batch={openBatch} department={openDepartment} collegeId={collegeId} readOnly />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
