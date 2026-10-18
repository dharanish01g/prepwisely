import { type ChangeEvent, type FormEvent, useRef, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, ImageUpIcon, LightbulbIcon, LockIcon, PlusIcon, RotateCcwIcon, SparklesIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Markdown, MarkdownField } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { type PcCategory, type PcDomain, slugify } from "@/lib/practice";
import { MAX_PROMPT, MIN_PROMPT } from "@/lib/practice-ai";
import {
  applyGeneratedMcq,
  emptyOption,
  MAX_HINTS,
  MAX_OPTIONS,
  type McqOption,
  type McqQuestion,
  mcqPublishChecks,
  MIN_OPTIONS,
  shuffled,
  uploadQuestionImage,
  useGenerateMcq,
  useSaveMcq,
} from "@/lib/practice-mcq";
import { useSetQuestionPublished } from "@/lib/practice-questions-data";
import { DIFFICULTIES } from "@/lib/practice-questions";
import { CategoryDialog, ChecksPanel, difficultyLabel, Ok, Section, StatusBadge, Toggle } from "@/screens/practice-questions";

// The MCQ editor (a drill-down from an MCQ card's questions): the fields on the left and, on the right, the question
// as a student answers it in PrepCode. Laid out like the coding editor; saved through pc_mcq_save (practice-mcq.ts).

/** The image box both apps use: the panel's full width, at most 320 px tall, scaled to fit, never cropped. */
function QuestionImage({ url, alt }: { url: string; alt: string }) {
  return (
    <div className="flex max-h-80 w-full items-center justify-center border bg-muted/30">
      <img src={url} alt={alt} className="max-h-80 w-full object-contain" />
    </div>
  );
}

export function McqEditor({
  initial,
  isNew,
  domains,
  categories,
  onSaved,
  onDone,
}: {
  initial: McqQuestion;
  isNew: boolean;
  domains: PcDomain[];
  /** The MCQ categories a question can sit in. */
  categories: PcCategory[];
  /** After a save; a new question then reopens from the database under its id. */
  onSaved: (id: string) => void;
  onDone: () => void;
}) {
  const [q, setQ] = useState(initial);
  const saveMcq = useSaveMcq();
  const setPublished = useSetQuestionPublished();
  const [uploading, setUploading] = useState(false);
  const busy = saveMcq.isPending || setPublished.isPending || uploading;
  const [slugEdited, setSlugEdited] = useState(!isNew);
  const [showChecks, setShowChecks] = useState(false);
  const [moving, setMoving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<McqQuestion>) => setQ((x) => ({ ...x, ...patch }));

  const published = initial.status === "published";
  const checks = mcqPublishChecks(q);
  const ready = checks.every((c) => c.ok);
  const category = categories.find((c) => c.slug === q.category_slug);
  const domain = domains.find((d) => d.id === category?.domain_id);

  // AI draft (new questions only): fills every card below from the author's description; nothing is saved.
  const [prompt, setPrompt] = useState("");
  const generate = useGenerateMcq();
  const [working, setWorking] = useState("");
  const filled = q.title.trim() !== "" || q.description.trim() !== "";

  async function generateDraft() {
    if (!category) {
      toast.error("Choose a category first.");
      return;
    }
    try {
      const g = await generate.mutateAsync({ categoryId: category.id, prompt });
      setQ((x) => applyGeneratedMcq(x, g));
      setWorking(g.working ?? "");
      setSlugEdited(false);
      toast.success("Draft filled in. Check the answer against the AI's working before publishing.");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  /** Saves everything and returns the question's id. */
  async function persist(): Promise<string> {
    if (!category) throw new Error("Choose a category first");
    return saveMcq.mutateAsync({ id: isNew ? null : q.id, categoryId: category.id, question: q });
  }

  async function act(work: () => Promise<string>, message: string) {
    try {
      const id = await work();
      toast.success(message);
      onSaved(id);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void act(persist, "Saved.");
  }

  function publish() {
    setShowChecks(true);
    if (!ready) {
      toast.error("Not ready to publish yet. See the list above.");
      return;
    }
    void act(async () => {
      const id = await persist();
      await setPublished.mutateAsync({ id, published: true });
      return id;
    }, `Published ${q.title.trim()}. PrepCode shows it now.`);
  }

  function unpublish() {
    // Back to draft first, so the save that follows may be incomplete.
    void act(async () => {
      await setPublished.mutateAsync({ id: q.id, published: false });
      return persist();
    }, `Moved ${q.title.trim()} back to draft. It's hidden from PrepCode.`);
  }

  async function handleImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      set({ image_url: await uploadQuestionImage(file) });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  // Options
  function setOption(id: string, patch: Partial<McqOption>) {
    set({ options: q.options.map((o) => (o.id === id ? { ...o, ...patch } : o)) });
  }
  function markCorrect(id: string) {
    set({ options: q.options.map((o) => ({ ...o, is_correct: o.id === id })) });
  }
  function moveOption(index: number, by: -1 | 1) {
    const options = [...q.options];
    [options[index], options[index + by]] = [options[index + by], options[index]];
    set({ options });
  }

  // Hints
  function setHint(index: number, value: string) {
    set({ hints: q.hints.map((h, i) => (i === index ? value : h)) });
  }
  function moveHint(index: number, by: -1 | 1) {
    const hints = [...q.hints];
    [hints[index], hints[index + by]] = [hints[index + by], hints[index]];
    set({ hints });
  }

  const correctCount = q.options.filter((o) => o.is_correct).length;
  const hintCount = q.hints.filter((h) => h.trim() !== "").length;

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{isNew ? "New question" : q.title || "Untitled"}</h1>
            <StatusBadge status={initial.status} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>
              {domain?.title ?? "No domain"} › <span className="text-foreground">{category?.title ?? "No category"}</span>
            </span>
            <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={() => setMoving(true)}>
              Change
            </Button>
            {!isNew && q.category_slug !== initial.category_slug && <span className="text-xs">Saving puts it last in the new category.</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onDone}>
            Back to list
          </Button>
          {published ? (
            <>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={unpublish}>
                Move to draft
              </Button>
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? "Saving…" : "Save changes"}
              </Button>
            </>
          ) : (
            <>
              <Button type="submit" variant="outline" size="sm" disabled={busy}>
                {saveMcq.isPending && !setPublished.isPending ? "Saving…" : "Save draft"}
              </Button>
              <Button type="button" size="sm" disabled={busy} onClick={publish}>
                Publish
              </Button>
            </>
          )}
        </div>
      </div>

      {(showChecks || published) && !ready && <ChecksPanel checks={checks} />}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="grid min-w-0 content-start gap-4">
          {isNew && (
            <Section title="Describe the question" aside={<span className="text-xs text-muted-foreground">Drafted with AI</span>}>
              <div className="grid gap-1.5">
                <Label htmlFor="mcq_prompt">What do you need?</Label>
                <Textarea
                  id="mcq_prompt"
                  rows={4}
                  maxLength={MAX_PROMPT}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g. An easy percentage question on a price that goes up 20% and then down 20%, for a festival sale."
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" size="sm" disabled={generate.isPending || prompt.trim().length < MIN_PROMPT} onClick={() => void generateDraft()}>
                  <SparklesIcon />
                  {generate.isPending ? "Generating…" : filled ? "Generate again" : "Generate"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {filled
                    ? "Generating again replaces everything below except the image."
                    : "Fills every card below with a draft: the question, 4 options with explanations, and hints. Nothing is saved until you save."}
                </span>
              </div>
              {working && (
                <div className="grid gap-1 border bg-muted/30 p-3">
                  <p className="text-xs font-medium">How the AI solved it (not saved)</p>
                  <Markdown className="text-xs">{working}</Markdown>
                  <p className="text-xs text-muted-foreground">Check the option marked correct against this before publishing.</p>
                </div>
              )}
            </Section>
          )}

          <Section n={1} title="Basics">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="mcq_title">Title</Label>
                <Input
                  id="mcq_title"
                  placeholder="e.g. Train Crossing a Platform"
                  maxLength={80}
                  value={q.title}
                  onChange={(e) => set(slugEdited ? { title: e.target.value } : { title: e.target.value, slug: slugify(e.target.value) })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="mcq_slug">Slug</Label>
                <Input
                  id="mcq_slug"
                  placeholder="e.g. train-crossing-a-platform"
                  maxLength={64}
                  value={q.slug}
                  disabled={published}
                  onChange={(e) => {
                    set({ slug: e.target.value });
                    setSlugEdited(true);
                  }}
                />
                <p className="text-xs text-muted-foreground">{published ? "Can't be changed once published." : "Fixed once published."}</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label>Difficulty</Label>
                <Toggle value={q.difficulty} items={DIFFICULTIES} onChange={(difficulty) => set({ difficulty })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="mcq_topic">Topic</Label>
                <Input id="mcq_topic" placeholder="e.g. Percentages, Time and Distance" maxLength={40} value={q.topic} onChange={(e) => set({ topic: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>Access</Label>
                <Toggle
                  value={q.access}
                  items={[
                    { value: "public", label: "Public" },
                    { value: "private", label: "Private" },
                  ]}
                  onChange={(access) => set({ access })}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {q.access === "public" ? "Public: every PrepCode student, guests included." : "Private: only students of colleges that subscribe to this category."}
            </p>
          </Section>

          <Section n={2} title="Question">
            <MarkdownField
              id="mcq_description"
              label="Question"
              rows={6}
              value={q.description}
              onChange={(description) => set({ description })}
              placeholder="A short real-life setting with every fact needed, ending with the question. Don't list the options here."
            />
            <div className="grid gap-2">
              <Label>Image (optional)</Label>
              {q.image_url && <QuestionImage url={q.image_url} alt={q.image_alt} />}
              <div className="flex flex-wrap items-center gap-2">
                <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void handleImage(e)} />
                <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileInput.current?.click()}>
                  <ImageUpIcon />
                  {uploading ? "Uploading…" : q.image_url ? "Replace image" : "Upload image"}
                </Button>
                {q.image_url && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => set({ image_url: null, image_alt: "" })}>
                    <XIcon />
                    Remove
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Shown above the question. Landscape works best, about 1200 × 675; PNG, JPG or WebP, up to 500 KB.
              </p>
              {q.image_url && (
                <div className="grid gap-1.5">
                  <Label htmlFor="mcq_image_alt">Image description</Label>
                  <Input
                    id="mcq_image_alt"
                    maxLength={300}
                    placeholder="e.g. Bar chart of ShopKart's sales from January to June"
                    value={q.image_alt}
                    onChange={(e) => set({ image_alt: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">Read out by screen readers, and shown if the image doesn't load. Needed to publish.</p>
                </div>
              )}
            </div>
          </Section>

          <Section
            n={3}
            title="Options"
            aside={
              <Ok ok={correctCount === 1 && q.options.length >= MIN_OPTIONS}>
                {q.options.length} options · {correctCount === 1 ? "1 correct ✓" : correctCount === 0 ? "none marked correct" : `${correctCount} marked correct`}
              </Ok>
            }
          >
            {q.options.map((o, i) => (
              <div key={o.id} className="grid gap-3 border p-3">
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="radio" name="mcq_correct" checked={o.is_correct} onChange={() => markCorrect(o.id)} />
                    Option {i + 1}
                    {o.is_correct && <span className="text-primary">· correct answer</span>}
                  </label>
                  <div className="flex">
                    <Button type="button" variant="ghost" size="icon-xs" aria-label={`Move option ${i + 1} up`} disabled={i === 0} onClick={() => moveOption(i, -1)}>
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Move option ${i + 1} down`}
                      disabled={i === q.options.length - 1}
                      onClick={() => moveOption(i, 1)}
                    >
                      <ArrowDownIcon />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      title="Remove"
                      aria-label={`Remove option ${i + 1}`}
                      disabled={q.options.length <= MIN_OPTIONS}
                      onClick={() => set({ options: q.options.filter((x) => x.id !== o.id) })}
                    >
                      <XIcon />
                    </Button>
                  </div>
                </div>
                <MarkdownField id={`mcq_option_${o.id}`} label="Option text" rows={2} value={o.body} onChange={(body) => setOption(o.id, { body })} />
                <MarkdownField
                  id={`mcq_explanation_${o.id}`}
                  label={o.is_correct ? "Why it's right" : "Why it's wrong"}
                  rows={2}
                  value={o.explanation}
                  onChange={(explanation) => setOption(o.id, { explanation })}
                  placeholder={o.is_correct ? "Show the working that gets this answer." : "Name the mistake that gives this value, and how to fix it."}
                />
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" size="sm" disabled={q.options.length >= MAX_OPTIONS} onClick={() => set({ options: [...q.options, emptyOption()] })}>
                <PlusIcon />
                Option
              </Button>
              <span className="text-xs text-muted-foreground">
                {MIN_OPTIONS} to {MAX_OPTIONS} options, exactly one correct. Students see them shuffled, so avoid "All of the above" or "Both A and B".
              </span>
            </div>
          </Section>

          <Section
            n={4}
            title="Hints"
            aside={
              <Ok ok={hintCount >= 1}>
                {hintCount} of {MAX_HINTS}
                {hintCount >= 1 ? " ✓" : ", at least 1"}
              </Ok>
            }
          >
            {q.hints.map((h, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <MarkdownField id={`mcq_hint_${i}`} label={`Hint ${i + 1}`} rows={2} value={h} onChange={(value) => setHint(i, value)} />
                </div>
                <div className="flex pt-6">
                  <Button type="button" variant="ghost" size="icon-xs" aria-label={`Move hint ${i + 1} up`} disabled={i === 0} onClick={() => moveHint(i, -1)}>
                    <ArrowUpIcon />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-xs" aria-label={`Move hint ${i + 1} down`} disabled={i === q.hints.length - 1} onClick={() => moveHint(i, 1)}>
                    <ArrowDownIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    title="Remove"
                    aria-label={`Remove hint ${i + 1}`}
                    disabled={q.hints.length <= 1}
                    onClick={() => set({ hints: q.hints.filter((_, x) => x !== i) })}
                  >
                    <XIcon />
                  </Button>
                </div>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" size="sm" disabled={q.hints.length >= MAX_HINTS} onClick={() => set({ hints: [...q.hints, ""] })}>
                <PlusIcon />
                Hint
              </Button>
              <span className="text-xs text-muted-foreground">Students open them in order: each a stronger nudge than the last, never the answer.</span>
            </div>
          </Section>
        </div>

        <div className="min-w-0">
          <div className="grid gap-2 xl:sticky xl:top-4">
            <p className="text-sm font-medium">Student preview</p>
            <StudentPreview q={q} categoryTitle={category?.title ?? ""} />
          </div>
        </div>
      </div>

      <CategoryDialog
        open={moving}
        title="Move question"
        description="Choose the MCQ category this question belongs to."
        action="Move here"
        domains={domains}
        categories={categories}
        initialDomainId={category?.domain_id}
        initialSlug={q.category_slug}
        onClose={() => setMoving(false)}
        onPick={(slug) => {
          setMoving(false);
          set({ category_slug: slug });
        }}
      />
    </form>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// What the student sees: pick an option, see its explanation; a wrong pick reshuffles, as in PrepCode
// ---------------------------------------------------------------------------------------------------------------

function StudentPreview({ q, categoryTitle }: { q: McqQuestion; categoryTitle: string }) {
  const [order, setOrder] = useState<string[]>(() => shuffled(q.options.map((o) => o.id)));
  const [missed, setMissed] = useState<string[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [hintsOpen, setHintsOpen] = useState(0);
  const hints = q.hints.filter((h) => h.trim() !== "");

  // Options added or removed in the editor join the shown order, or leave it.
  const ids = q.options.map((o) => o.id);
  const shown = [...order.filter((id) => ids.includes(id)), ...ids.filter((id) => !order.includes(id))];
  const byId = new Map(q.options.map((o) => [o.id, o]));
  const solved = picked !== null && byId.get(picked)?.is_correct === true;

  function pick(id: string) {
    if (solved) return;
    setPicked(id);
    if (!byId.get(id)?.is_correct) {
      setMissed((m) => (m.includes(id) ? m : [...m, id]));
      setOrder(shuffled(shown));
    }
  }

  function reset() {
    setOrder(shuffled(ids));
    setMissed([]);
    setPicked(null);
    setHintsOpen(0);
  }

  const last = picked ? byId.get(picked) : undefined;

  return (
    <div className="grid gap-4 border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {categoryTitle && <p className="text-xs text-muted-foreground">{categoryTitle}</p>}
          <p className="text-lg font-semibold">{q.title.trim() || "Title"}</p>
          <p className="text-xs text-muted-foreground">
            {difficultyLabel(q.difficulty)}
            {q.topic.trim() && ` · ${q.topic.trim()}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {q.access === "private" && <LockIcon className="size-3.5 text-muted-foreground" aria-label="Private" />}
          <Button type="button" variant="ghost" size="icon-sm" title="Start again" aria-label="Start the preview again" onClick={reset}>
            <RotateCcwIcon />
          </Button>
        </div>
      </div>

      {q.image_url && <QuestionImage url={q.image_url} alt={q.image_alt} />}
      {q.description.trim() ? <Markdown>{q.description}</Markdown> : <p className="text-sm text-muted-foreground">The question appears here.</p>}

      <div className="grid gap-2">
        {shown.map((id, i) => {
          const o = byId.get(id)!;
          const wrong = missed.includes(id);
          const right = solved && id === picked;
          return (
            <button
              key={id}
              type="button"
              disabled={solved || wrong}
              onClick={() => pick(id)}
              className={cn(
                "flex items-start gap-2 border px-3 py-2 text-left text-sm",
                right && "border-emerald-600 bg-emerald-600/10",
                wrong && "border-destructive/50 bg-destructive/5 text-muted-foreground",
                !solved && !wrong && "hover:bg-muted/50",
              )}
            >
              <span className="w-4 shrink-0 font-medium">{String.fromCharCode(65 + i)}</span>
              <span className="min-w-0 flex-1">{o.body.trim() ? <Markdown>{o.body}</Markdown> : <span className="text-muted-foreground">Option text</span>}</span>
              {right && <CheckIcon className="size-4 shrink-0 text-emerald-600" />}
              {wrong && <XIcon className="size-4 shrink-0 text-destructive" />}
            </button>
          );
        })}
      </div>

      {last && (
        <div className={cn("grid gap-1 border p-3 text-sm", solved ? "border-emerald-600/50" : "border-destructive/40")}>
          <p className="font-medium">{solved ? (missed.length === 0 ? "Correct on the first pick" : "Correct") : "Not quite"}</p>
          {last.explanation.trim() ? <Markdown>{last.explanation}</Markdown> : <p className="text-muted-foreground">This option's explanation appears here.</p>}
          {!solved && <p className="text-xs text-muted-foreground">The options have been shuffled. Try again.</p>}
        </div>
      )}

      {hints.length > 0 && !solved && (
        <div className="grid gap-2">
          {hints.slice(0, hintsOpen).map((h, i) => (
            <div key={i} className="grid gap-1 border bg-muted/30 p-3 text-sm">
              <p className="text-xs font-medium">Hint {i + 1}</p>
              <Markdown>{h}</Markdown>
            </div>
          ))}
          {hintsOpen < hints.length && (
            <div>
              <Button type="button" variant="outline" size="sm" onClick={() => setHintsOpen((n) => n + 1)}>
                <LightbulbIcon />
                Hint {hintsOpen + 1} of {hints.length}
              </Button>
            </div>
          )}
        </div>
      )}

      {solved && (
        <div className="flex items-center gap-2">
          <Badge variant="outline">Done</Badge>
          <span className="text-xs text-muted-foreground">
            {missed.length === 0 ? "Counts as correct." : `Found on pick ${missed.length + 1}: counts as wrong.`}
          </span>
        </div>
      )}
    </div>
  );
}
