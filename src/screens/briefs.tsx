import { useMemo, useState } from "react";
import { ArrowLeftIcon, Loader2Icon, PlusIcon, SearchIcon } from "lucide-react";
import { toast } from "sonner";
import { BriefDialog } from "@/components/brief-dialog";
import { BriefProgress } from "@/components/brief-progress";
import { FilterSelect } from "@/components/filter-select";
import { Markdown } from "@/components/markdown";
import { RefreshButton } from "@/components/refresh-button";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { briefTotals, isOverdue } from "@/lib/brief-logic";
import { type BriefRow, useBriefContributions, useBriefs, useContentTeam, useSetBriefStatus } from "@/lib/briefs";
import { useCategoryPaths } from "@/lib/categories";
import { useRefreshQuestions } from "@/lib/questions";

const STATUS_ITEMS = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All briefs" },
];

/** Names for assigned creators; falls back to "Unknown" if a profile isn't readable. */
function useNames() {
  const { data: team = [] } = useContentTeam();
  return useMemo(() => new Map(team.map((m) => [m.id, m.full_name])), [team]);
}

function DeadlineCell({ brief }: { brief: BriefRow }) {
  const overdue = isOverdue(brief, briefTotals(brief, brief.progress).complete);
  if (!brief.deadline) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex items-center gap-1.5">
      <span className={overdue ? "text-destructive" : "text-muted-foreground"}>{new Date(brief.deadline + "T00:00:00").toLocaleDateString()}</span>
      {overdue && <Badge variant="destructive">Overdue</Badge>}
    </span>
  );
}

export function BriefsScreen() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("open");
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ brief: BriefRow | null } | null>(null);

  const { data: briefs = [], isPending, isFetching, error } = useBriefs();
  const refresh = useRefreshQuestions();
  const names = useNames();
  const categoryPath = useCategoryPaths();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return briefs.filter((b) => (status === "all" || b.status === status) && (!q || `${b.title} ${categoryPath.get(b.category_id) ?? ""}`.toLowerCase().includes(q)));
  }, [briefs, query, status, categoryPath]);

  const open = openId ? briefs.find((b) => b.id === openId) : undefined;

  return (
    <>
      {open ? (
        <BriefPanel brief={open} onBack={() => setOpenId(null)} onEdit={() => setDialog({ brief: open })} />
      ) : (
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">Briefs & targets</h1>
              <p className="text-sm text-muted-foreground">Tell creators what to write and track what has been delivered.</p>
            </div>
            <div className="flex gap-2">
              <RefreshButton onRefresh={() => void refresh()} refreshing={isFetching} />
              <Button size="sm" onClick={() => setDialog({ brief: null })}>
                <PlusIcon />
                New brief
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="relative w-full max-w-sm">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search by title or topic" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
            </div>
            <FilterSelect aria-label="Filter by status" value={status} items={STATUS_ITEMS} onChange={setStatus} className="w-36" />
          </div>

          <div className="border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Brief</TableHead>
                  <TableHead>Topic</TableHead>
                  <TableHead>Progress (approved)</TableHead>
                  <TableHead>Deadline</TableHead>
                  <TableHead>Creators</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isPending ? (
                  <TableSkeletonRows columns={["w-40", "w-28", "w-40", "w-24", "w-28", "w-16", "w-12 ml-auto"]} />
                ) : error || filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className={`h-24 text-center ${error ? "text-destructive" : "text-muted-foreground"}`}>
                      {error ? `Could not load briefs: ${error.message}` : briefs.length === 0 ? "No briefs yet. Create one to get creators writing." : "No briefs match."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="max-w-56 truncate font-medium">{b.title}</TableCell>
                      <TableCell className="max-w-40 truncate text-muted-foreground">{categoryPath.get(b.category_id) ?? "—"}</TableCell>
                      <TableCell>
                        <BriefProgress brief={b} progress={b.progress} />
                      </TableCell>
                      <TableCell>
                        <DeadlineCell brief={b} />
                      </TableCell>
                      <TableCell className="max-w-40 truncate text-muted-foreground">
                        {b.creator_ids.length ? b.creator_ids.map((id) => names.get(id) ?? "Unknown").join(", ") : "Unassigned"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={b.status === "open" ? "default" : "secondary"} className="capitalize">
                          {b.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <Button variant="outline" size="xs" onClick={() => setOpenId(b.id)}>
                            View
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
      <BriefDialog state={dialog} onClose={() => setDialog(null)} />
    </>
  );
}

function BriefPanel({ brief, onBack, onEdit }: { brief: BriefRow; onBack: () => void; onEdit: () => void }) {
  const categoryPath = useCategoryPaths();
  const names = useNames();
  const { data: contributions, isPending } = useBriefContributions(brief.id);
  const setStatus = useSetBriefStatus();
  const closing = brief.status === "open";

  function toggleStatus() {
    setStatus.mutate(
      { id: brief.id, status: closing ? "closed" : "open" },
      { onSuccess: () => toast.success(`${closing ? "Closed" : "Reopened"}: “${brief.title}”.`) },
    );
  }

  return (
    <div className="flex max-w-3xl flex-1 flex-col gap-5 p-4 pt-0">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
          <ArrowLeftIcon />
          Back to briefs
        </Button>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-2">
          <h1 className="text-2xl font-semibold">{brief.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={closing ? "default" : "secondary"} className="capitalize">
              {brief.status}
            </Badge>
            <span>{categoryPath.get(brief.category_id) ?? "—"}</span>
            <span>·</span>
            <DeadlineCell brief={brief} />
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button variant={closing ? "outline" : "default"} size="sm" onClick={toggleStatus} disabled={setStatus.isPending}>
            {closing ? "Close brief" : "Reopen"}
          </Button>
        </div>
      </div>
      {setStatus.error && <p className="text-xs text-destructive">{setStatus.error.message}</p>}

      {brief.description.trim() && <Markdown>{brief.description}</Markdown>}

      <div className="grid gap-2 border p-3">
        <p className="text-xs font-medium">Progress</p>
        <BriefProgress brief={brief} progress={brief.progress} full />
        <p className="text-xs text-muted-foreground">Only approved, non-archived questions count. Drafts aren't visible to you.</p>
      </div>

      <div className="grid gap-2">
        <h2 className="text-base font-semibold">Who is contributing</h2>
        <div className="border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Creator</TableHead>
                <TableHead>Approved</TableHead>
                <TableHead>In review</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={3} className="h-16 text-center">
                    <Loader2Icon className="mx-auto size-4 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : !contributions?.length ? (
                <TableRow>
                  <TableCell colSpan={3} className="h-16 text-center text-muted-foreground">
                    No creators are assigned yet. Use Edit to assign some.
                  </TableCell>
                </TableRow>
              ) : (
                contributions.map((c) => (
                  <TableRow key={c.creator_id}>
                    <TableCell className="font-medium">
                      {names.get(c.creator_id) ?? "Unknown"}
                      {!brief.creator_ids.includes(c.creator_id) && <span className="ml-2 text-xs font-normal text-muted-foreground">no longer assigned</span>}
                    </TableCell>
                    <TableCell>{c.approved}</TableCell>
                    <TableCell className="text-muted-foreground">{c.in_review}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
