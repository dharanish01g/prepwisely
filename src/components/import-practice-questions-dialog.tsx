import { type ChangeEvent, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { CheckIcon, DownloadIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PcCategory, PcDomain } from "@/lib/practice";
import {
  buildPracticeImportPreview,
  MAX_PRACTICE_IMPORT_ROWS,
  type PracticeImportPreview,
  type PracticeImportRow,
  practiceImportTemplateCsv,
} from "@/lib/practice-import";
import { type Language, languageLabel, publishChecks } from "@/lib/practice-questions";
import { publishQuestionNow, saveQuestionNow, useInvalidatePracticeQuestions } from "@/lib/practice-questions-data";
import { readImportFile } from "@/lib/question-import";
import { useRuntimes } from "@/lib/runtimes";
import { runSolution } from "@/lib/solution-runner";

// Bulk import of coding questions (practice-import.ts has the file format). Before saving, every solution in the file
// is run against its question's test cases on this computer, exactly as the editor's Run does, so imported questions
// can be published straight away. Each row is saved on its own: one bad row doesn't stop the rest.

type Outcome = { kind: "published" | "draft" | "failed"; message: string };

export function ImportPracticeQuestionsDialog({
  open,
  onOpenChange,
  domains,
  categories,
  existingSlugs,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  domains: PcDomain[];
  categories: PcCategory[];
  existingSlugs: Set<string>;
}) {
  const runtimes = useRuntimes();
  const invalidate = useInvalidatePracticeQuestions();
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<PracticeImportPreview | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [publishReady, setPublishReady] = useState(true);
  const [importing, setImporting] = useState(false);
  /** While importing: which row is being worked on, and what's happening. */
  const [progress, setProgress] = useState<{ done: number; row: number; step: string } | null>(null);
  const [outcomes, setOutcomes] = useState<Record<number, Outcome> | null>(null);
  const [savedTemplate, setSavedTemplate] = useState(false);
  const [inputKey, setInputKey] = useState(0);

  const valid = preview?.rows.filter((r) => r.question) ?? [];
  const invalid = (preview?.rows.length ?? 0) - valid.length;

  function reset() {
    setFileName(null);
    setPreview(null);
    setReadError(null);
    setOutcomes(null);
    setProgress(null);
    setInputKey((k) => k + 1);
  }

  function handleOpenChange(next: boolean) {
    if (importing) return;
    onOpenChange(next);
    if (!next) reset();
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    reset();
    setFileName(file.name);
    setReading(true);
    try {
      setPreview(buildPracticeImportPreview(await readImportFile(file), domains, categories, existingSlugs));
    } catch (err) {
      setReadError(err instanceof Error ? err.message : "Couldn't read that file");
    } finally {
      setReading(false);
    }
  }

  async function downloadTemplate() {
    setReadError(null);
    try {
      const path = await save({ defaultPath: "practice-questions-template.csv", filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (!path) return;
      // The byte-order mark makes Excel open the file as UTF-8 (the reader strips it again).
      const example = categories.find((c) => !c.archived_at)?.slug ?? "basics";
      await writeTextFile(path, "﻿" + practiceImportTemplateCsv(example));
      setSavedTemplate(true);
      setTimeout(() => setSavedTemplate(false), 3000);
    } catch (err) {
      setReadError(`Couldn't save the template: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Runs every solution of a row that can run here; returns the languages that passed and notes on the rest. */
  async function checkSolutions(r: PracticeImportRow): Promise<{ passing: Language[]; notes: string[] }> {
    const q = r.question!;
    const passing: Language[] = [];
    const notes: string[] = [];
    for (const language of r.languages) {
      const runtime = runtimes.data?.find((x) => x.id === language);
      if (!runtime?.installed) {
        notes.push(`${languageLabel(language)} not checked (runtime not installed)`);
        continue;
      }
      setProgress((p) => p && { ...p, step: `Running the ${languageLabel(language)} solution…` });
      try {
        const run = await runSolution(q, language);
        const results = Object.values(run.results);
        if (run.compileError !== null) notes.push(`${languageLabel(language)} didn't compile`);
        else if (results.length === q.test_cases.length && results.every((x) => x.status === "passed")) passing.push(language);
        else notes.push(`${languageLabel(language)} passes ${results.filter((x) => x.status === "passed").length} of ${q.test_cases.length} cases`);
      } catch (err) {
        notes.push(`${languageLabel(language)}: ${(err as Error).message}`);
      }
    }
    return { passing, notes };
  }

  async function handleImport() {
    setImporting(true);
    const results: Record<number, Outcome> = {};
    let done = 0;
    for (const r of valid) {
      const q = r.question!;
      setProgress({ done, row: r.row, step: "Checking solutions…" });
      const { passing, notes } = await checkSolutions(r);
      const categoryId = categories.find((c) => c.slug === q.category_slug)?.id;
      try {
        if (!categoryId) throw new Error("Category not found");
        setProgress({ done, row: r.row, step: "Saving…" });
        const id = await saveQuestionNow({ id: null, categoryId, question: q, passing });
        const failing = publishChecks(q, passing).filter((c) => !c.ok);
        if (publishReady && failing.length === 0) {
          setProgress({ done, row: r.row, step: "Publishing…" });
          await publishQuestionNow(id);
          results[r.row] = { kind: "published", message: "Published" };
        } else {
          const why = [...notes, ...failing.map((c) => c.label)];
          results[r.row] = { kind: "draft", message: why.length ? `Saved as a draft: ${why.join("; ")}` : "Saved as a draft" };
        }
      } catch (err) {
        results[r.row] = { kind: "failed", message: (err as Error).message };
      }
      done += 1;
      setOutcomes({ ...results });
    }
    setProgress(null);
    setImporting(false);
    invalidate();
  }

  const counts = outcomes && {
    published: Object.values(outcomes).filter((o) => o.kind === "published").length,
    draft: Object.values(outcomes).filter((o) => o.kind === "draft").length,
    failed: Object.values(outcomes).filter((o) => o.kind === "failed").length,
  };
  const missingRuntimes = [...new Set(valid.flatMap((r) => r.languages))].filter((l) => runtimes.data && !runtimes.data.find((x) => x.id === l)?.installed);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Import coding questions</DialogTitle>
          <DialogDescription>
            Upload a .csv or .xlsx file with one question per row. Every row is checked, and every solution is run against its test cases on this
            computer, before anything is saved.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {!outcomes && !importing && (
            <div className="grid gap-2">
              <Input key={inputKey} type="file" accept=".csv,.xlsx" onChange={(e) => void handleFile(e)} disabled={reading} />
              {reading && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2Icon className="size-3.5 animate-spin" />
                  Reading {fileName}…
                </p>
              )}
              {readError && <p className="text-xs text-destructive">{readError}</p>}
              {preview?.fileError && <p className="text-xs text-destructive">{preview.fileError}</p>}
            </div>
          )}

          {!preview && !reading && <FormatGuide saved={savedTemplate} onDownload={() => void downloadTemplate()} />}

          {preview && !preview.fileError && (
            <>
              {counts ? (
                <p className="text-xs">
                  <span className="font-medium">
                    {counts.published} published, {counts.draft} saved as drafts
                  </span>
                  {counts.failed > 0 && <span className="text-destructive">, {counts.failed} failed</span>}
                  <span className="text-muted-foreground"> · {fileName}</span>
                </p>
              ) : (
                <p className="text-xs">
                  <span className="font-medium">{valid.length} ready to import</span>
                  {invalid > 0 && <span className="text-destructive">, {invalid} with problems (these will be skipped)</span>}
                  <span className="text-muted-foreground"> · {fileName}</span>
                </p>
              )}

              {progress && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2Icon className="size-3.5 animate-spin" />
                  {progress.done + 1} of {valid.length} · row {progress.row}: {progress.step}
                </p>
              )}

              <div className="max-h-80 overflow-auto border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Row</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="w-24">Cases</TableHead>
                      <TableHead>Solutions</TableHead>
                      <TableHead>Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rows.map((r) => {
                      const outcome = outcomes?.[r.row];
                      return (
                        <TableRow key={r.row}>
                          <TableCell className="text-muted-foreground">{r.row}</TableCell>
                          <TableCell className="max-w-48">
                            <p className="truncate font-medium">{r.title || "—"}</p>
                            <p className="truncate text-muted-foreground">{r.slug || "—"}</p>
                          </TableCell>
                          <TableCell className="max-w-36 truncate text-muted-foreground">{r.category || "—"}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {r.question ? `${r.examples} + ${r.hidden} hidden` : "—"}
                          </TableCell>
                          <TableCell className="max-w-36 text-muted-foreground">{r.languages.map(languageLabel).join(", ") || "None"}</TableCell>
                          <TableCell
                            className={
                              r.error || outcome?.kind === "failed"
                                ? "text-destructive"
                                : outcome?.kind === "published"
                                  ? "text-emerald-600"
                                  : "text-muted-foreground"
                            }
                          >
                            <span className="whitespace-normal">
                              {r.error ??
                                outcome?.message ??
                                (progress?.row === r.row ? (
                                  progress.step
                                ) : (
                                  <span className="inline-flex items-center gap-1">
                                    <CheckIcon className="size-3.5" /> Ready
                                  </span>
                                ))}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {!outcomes && !importing && (
                <>
                  {missingRuntimes.length > 0 && (
                    <p className="text-xs text-destructive">
                      {missingRuntimes.map(languageLabel).join(", ")} runtime not installed: those solutions are saved but not checked, so their
                      questions stay drafts until someone runs them.
                    </p>
                  )}
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" className="accent-primary" checked={publishReady} onChange={(e) => setPublishReady(e.target.checked)} />
                    Publish the questions that pass every check (the rest are saved as drafts)
                  </label>
                </>
              )}

              <DialogFooter>
                {outcomes && !importing ? (
                  <Button onClick={() => handleOpenChange(false)}>Done</Button>
                ) : (
                  <>
                    <Button variant="ghost" onClick={reset} disabled={importing}>
                      Choose another file
                    </Button>
                    <Button onClick={() => void handleImport()} disabled={valid.length === 0 || importing}>
                      {importing ? "Importing…" : `Check and import ${valid.length} question${valid.length === 1 ? "" : "s"}`}
                    </Button>
                  </>
                )}
              </DialogFooter>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FormatGuide({ saved, onDownload }: { saved: boolean; onDownload: () => void }) {
  return (
    <div className="grid gap-2 border p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">File format</p>
        <Button type="button" variant="outline" size="xs" onClick={onDownload}>
          {saved ? <CheckIcon /> : <DownloadIcon />}
          {saved ? "Saved" : "Download CSV template"}
        </Button>
      </div>
      <p className="text-muted-foreground">The first row must be a header. One question per row, up to {MAX_PRACTICE_IMPORT_ROWS} per file.</p>
      <ul className="grid gap-1 text-muted-foreground">
        <li>
          <code>category</code>: the category's slug (e.g. <code>basics</code>) or title. <code>title</code>; <code>slug</code> (optional, made from the
          title); <code>difficulty</code>: easy, medium or hard; <code>topic</code>; <code>access</code>: public (default) or private.
        </li>
        <li>
          <code>description</code> (the case study, markdown), <code>constraints</code>, <code>explanation</code>.
        </li>
        <li>
          <code>method</code>, e.g. <code>isLeapYear</code>; <code>params</code>, e.g. <code>nums int[], target int</code>; <code>returns</code>: int,
          long, bool, string, int[] or string[].
        </li>
        <li>
          <code>examples</code> and <code>hidden</code>: one test case per line, <code>inputs =&gt; expected</code>, values as JSON in parameter order.
          Strings in quotes. An example can end with <code># a note</code>:
          <pre className="mt-1 bg-muted px-2 py-1 font-mono">{'2024 => true\n2000 => true # divisible by 400\n[1, 2, 3], 5 => "found"'}</pre>
        </li>
        <li>
          <code>solution_python</code>, <code>solution_java</code>, <code>solution_cpp</code>, <code>solution_c</code>, <code>solution_csharp</code>: as
          many as you have (at least one to publish). Each is run against the test cases before saving.
        </li>
      </ul>
      <p className="text-muted-foreground">
        Questions that pass every check (100-word case study, 3 examples, every solution passing) can be published straight away; the rest are
        saved as drafts to finish in the editor.
      </p>
    </div>
  );
}
