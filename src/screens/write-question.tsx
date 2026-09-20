import { type FormEvent, useMemo, useState } from "react";
import { InfoIcon, Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { Markdown, MarkdownField } from "@/components/markdown";
import { QuestionStatusBadge } from "@/components/question-status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildCategoryRows, useCategories } from "@/lib/categories";
import {
  DIFFICULTIES,
  type Difficulty,
  isLocked,
  newOption,
  type OptionInput,
  type QuestionDetail,
  useQuestion,
  useSaveQuestion,
  useSubmitQuestion,
  validateDraft,
  validateForSubmit,
} from "@/lib/questions";

interface WriteQuestionScreenProps {
  /** Question to edit; null/undefined starts a new draft. */
  questionId?: string | null;
  /** Called after the question has been submitted for review. */
  onDone: () => void;
}

export function WriteQuestionScreen({ questionId, onDone }: WriteQuestionScreenProps) {
  const { data, isPending, error } = useQuestion(questionId ?? null);

  if (questionId && isPending) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (questionId && error) {
    return <p className="p-4 pt-0 text-sm text-destructive">Could not load this question: {error.message}</p>;
  }
  return <QuestionEditor key={data?.id ?? "new"} initial={data ?? null} onDone={onDone} />;
}

function QuestionEditor({ initial, onDone }: { initial: QuestionDetail | null; onDone: () => void }) {
  const [id, setId] = useState(initial?.id ?? null);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(initial?.category_id ?? null);
  const [difficulty, setDifficulty] = useState<Difficulty | null>(initial?.difficulty ?? null);
  const [options, setOptions] = useState<OptionInput[]>(initial?.options.length ? initial.options : [newOption(), newOption()]);
  // Option ids that exist in the database; anything in here but missing from the form gets deleted on save.
  const [persistedIds, setPersistedIds] = useState<string[]>(initial?.options.map((o) => o.id) ?? []);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const { data: live } = useQuestion(id);
  const { data: categories = [] } = useCategories();
  const save = useSaveQuestion();
  const submit = useSubmitQuestion();
  const busy = save.isPending || submit.isPending;

  const status = live?.status ?? initial?.status ?? "draft";
  const archived = live?.archived ?? initial?.archived ?? false;
  const feedback = live?.latest_review ?? initial?.latest_review ?? null;
  const locked = isLocked(status, archived);

  const categoryItems = useMemo(
    () =>
      buildCategoryRows(categories)
        .filter((r) => r.category.is_active || r.category.id === categoryId)
        .map((r) => ({ value: r.category.id, label: r.path })),
    [categories, categoryId],
  );

  const input = { title, description, category_id: categoryId, difficulty, options };

  function updateOption(optionId: string, patch: Partial<OptionInput>) {
    setOptions((list) => list.map((o) => (o.id === optionId ? { ...o, ...patch } : o)));
  }

  function markCorrect(optionId: string) {
    setOptions((list) => list.map((o) => ({ ...o, is_correct: o.id === optionId })));
  }

  async function persist(): Promise<string> {
    const removedOptionIds = persistedIds.filter((pid) => !options.some((o) => o.id === pid));
    const savedId = await save.mutateAsync({ id: id ?? undefined, input, removedOptionIds });
    setId(savedId);
    setPersistedIds(options.map((o) => o.id));
    return savedId;
  }

  async function handleSaveDraft(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    const problem = validateDraft(input);
    if (problem) {
      setMessage({ kind: "error", text: problem });
      return;
    }
    try {
      await persist();
      setMessage({ kind: "ok", text: "Saved." });
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    }
  }

  async function handleSubmit() {
    setMessage(null);
    const problem = validateForSubmit(input);
    if (problem) {
      setMessage({ kind: "error", text: problem });
      return;
    }
    try {
      const savedId = await persist();
      await submit.mutateAsync(savedId);
      onDone();
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    }
  }

  return (
    <form noValidate onSubmit={handleSaveDraft} className="flex max-w-3xl flex-1 flex-col gap-5 p-4 pt-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{id ? "Edit question" : "Write question"}</h1>
          <p className="text-sm text-muted-foreground">
            Multiple choice with exactly one correct option. Every option needs an explanation of why it is right or wrong.
          </p>
        </div>
        {id && <QuestionStatusBadge status={status} archived={archived} />}
      </div>

      {feedback && (status === "changes_requested" || status === "rejected") && (
        <div className="border border-destructive/40 bg-destructive/5 p-3">
          <p className="mb-1 text-xs font-medium text-destructive">
            {status === "rejected" ? "Rejected by the reviewer" : "The reviewer asked for changes"}
          </p>
          {feedback.comment && <Markdown>{feedback.comment}</Markdown>}
          <p className="mt-2 text-xs text-muted-foreground">Fix the question below, then submit it for review again.</p>
        </div>
      )}
      {status === "approved" && !locked && (
        <Notice>Editing an approved question takes it out of tests until it is reviewed again.</Notice>
      )}
      {status === "unverified" && !locked && (
        <Notice>This question was edited after approval. Submit it for review to put it back in tests.</Notice>
      )}
      {status === "submitted" && !archived && <Notice>This question is in review and can't be edited right now.</Notice>}
      {archived && <Notice>This question is archived and can't be edited.</Notice>}

      <fieldset disabled={locked || busy} className="contents">
        <div className="grid gap-1.5">
          <Label htmlFor="question_title">Title</Label>
          <Input
            id="question_title"
            placeholder="A short headline for the question"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <MarkdownField
          id="question_description"
          label="Description"
          rows={5}
          placeholder="The full question. Markdown is supported."
          value={description}
          onChange={setDescription}
          disabled={locked || busy}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="question_category">Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId} items={categoryItems}>
              <SelectTrigger id="question_category" className="w-full">
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                {categoryItems.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="question_difficulty">Difficulty</Label>
            <Select value={difficulty} onValueChange={setDifficulty} items={DIFFICULTIES}>
              <SelectTrigger id="question_difficulty" className="w-full">
                <SelectValue placeholder="Select a difficulty" />
              </SelectTrigger>
              <SelectContent>
                {DIFFICULTIES.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-3">
          <h2 className="text-base font-semibold">Options</h2>
          {options.map((option, index) => {
            const explanationLabel = option.is_correct
              ? "Why this is correct"
              : options.some((o) => o.is_correct)
                ? "Why this is wrong"
                : "Explanation (why it is correct or wrong)";
            return (
              <div key={option.id} className="grid gap-3 border p-3">
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-xs font-medium">
                    <input
                      type="radio"
                      name="correct_option"
                      className="accent-primary"
                      checked={option.is_correct}
                      onChange={() => markCorrect(option.id)}
                      disabled={locked || busy}
                    />
                    Option {index + 1}
                    {option.is_correct && <span className="text-primary">· correct answer</span>}
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove option ${index + 1}`}
                    disabled={locked || busy || options.length <= 2}
                    onClick={() => setOptions((list) => list.filter((o) => o.id !== option.id))}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
                <MarkdownField
                  id={`option_body_${option.id}`}
                  label="Option text"
                  rows={2}
                  value={option.body}
                  onChange={(body) => updateOption(option.id, { body })}
                  disabled={locked || busy}
                />
                <MarkdownField
                  id={`option_explanation_${option.id}`}
                  label={explanationLabel}
                  rows={2}
                  value={option.explanation}
                  onChange={(explanation) => updateOption(option.id, { explanation })}
                  disabled={locked || busy}
                />
              </div>
            );
          })}
          <div>
            <Button type="button" variant="outline" size="sm" onClick={() => setOptions((list) => [...list, newOption()])}>
              <PlusIcon />
              Add option
            </Button>
          </div>
        </div>
      </fieldset>

      {message && (
        <p className={`text-xs ${message.kind === "error" ? "text-destructive" : "text-muted-foreground"}`}>{message.text}</p>
      )}

      {!locked && (
        <div className="flex gap-2 pb-4">
          <Button type="submit" variant="outline" disabled={busy}>
            {save.isPending && !submit.isPending ? "Saving…" : status === "draft" ? "Save draft" : "Save changes"}
          </Button>
          <Button type="button" disabled={busy} onClick={() => void handleSubmit()}>
            {submit.isPending ? "Submitting…" : "Submit for review"}
          </Button>
        </div>
      )}
    </form>
  );
}

function Notice({ children }: { children: string }) {
  return (
    <div className="flex items-start gap-2 border p-3 text-xs text-muted-foreground">
      <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
