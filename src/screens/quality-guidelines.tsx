import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Markdown, MarkdownField } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { useMyRoleIds } from "@/lib/roles";
import { useQualityGuidelines, useSaveQualityGuidelines } from "@/lib/quality-guidelines";

const EDITOR_ROLES = ["superadmin", "content_manager"];

export function QualityGuidelinesScreen() {
  const { data: roleIds } = useMyRoleIds();
  const canEdit = (roleIds ?? []).some((r) => EDITOR_ROLES.includes(r));
  const { data, isPending, error } = useQualityGuidelines();
  const save = useSaveQualityGuidelines();
  const [draft, setDraft] = useState<string | null>(null);

  const content = draft ?? data?.content ?? "";
  const dirty = draft !== null && draft !== data?.content;

  function handleSave() {
    if (draft === null) return;
    save.mutate(draft, {
      onSuccess: () => {
        toast.success("Quality guidelines saved.");
        setDraft(null);
      },
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div>
        <h1 className="text-2xl font-semibold">Quality guidelines</h1>
        <p className="text-sm text-muted-foreground">
          {canEdit
            ? "The quality bar reviewers check questions against. Saving here updates what every reviewer and creator sees."
            : "The quality bar your questions are reviewed against."}
        </p>
      </div>

      {isPending ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">Could not load the guidelines: {error.message}</p>
      ) : canEdit ? (
        <div className="flex max-w-3xl flex-col gap-3">
          <MarkdownField
            id="quality_guidelines"
            label="Guidelines"
            value={content}
            onChange={setDraft}
            rows={16}
            placeholder="Write the quality bar in markdown: what makes a question approvable, common mistakes, examples."
          />
          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={!dirty || save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
            {data?.updated_at && (
              <p className="text-xs text-muted-foreground">Last saved {new Date(data.updated_at).toLocaleString()}</p>
            )}
          </div>
          {save.error && <p className="text-xs text-destructive">{save.error.message}</p>}
        </div>
      ) : content.trim() ? (
        <div className="max-w-3xl">
          <Markdown>{content}</Markdown>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing published yet.</p>
      )}
    </div>
  );
}
