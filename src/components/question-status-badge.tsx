import { Badge } from "@/components/ui/badge";
import { type QuestionStatus, STATUS_META } from "@/lib/questions";

export function QuestionStatusBadge({ status, archived = false }: { status: QuestionStatus; archived?: boolean }) {
  const { label, variant } = STATUS_META[status];
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant={variant}>{label}</Badge>
      {archived && <Badge variant="secondary">Archived</Badge>}
    </span>
  );
}
