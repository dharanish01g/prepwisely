import { type ChangeEvent, useMemo, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { CheckIcon, DownloadIcon, Loader2Icon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buildCategoryRows, useCategories } from "@/lib/categories";
import {
  buildImportPreview,
  type CategoryChoice,
  type ImportPreview,
  importTemplateCsv,
  MAX_IMPORT_ROWS,
  readImportFile,
} from "@/lib/question-import";
import { useImportQuestions } from "@/lib/questions";

export function ImportQuestionsDialog() {
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [submitNow, setSubmitNow] = useState(true);
  const [imported, setImported] = useState<number | null>(null);
  const [savedTemplate, setSavedTemplate] = useState(false);
  const [inputKey, setInputKey] = useState(0);

  const { data: categories = [] } = useCategories();
  const importQuestions = useImportQuestions();

  // Only active categories can be used (the database rejects inactive ones on submit).
  const choices = useMemo<CategoryChoice[]>(
    () =>
      buildCategoryRows(categories)
        .filter((r) => r.category.is_active)
        .map((r) => ({ id: r.category.id, slug: r.category.slug, name: r.category.name, path: r.path })),
    [categories],
  );

  const valid = preview?.rows.filter((r) => r.question) ?? [];
  const invalid = (preview?.rows.length ?? 0) - valid.length;

  function reset() {
    setFileName(null);
    setPreview(null);
    setReadError(null);
    setImported(null);
    setInputKey((k) => k + 1);
    importQuestions.reset();
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    reset();
    setFileName(file.name);
    setReading(true);
    try {
      setPreview(buildImportPreview(await readImportFile(file), choices));
    } catch (err) {
      setReadError(err instanceof Error ? err.message : "Couldn't read that file");
    } finally {
      setReading(false);
    }
  }

  async function downloadTemplate() {
    setReadError(null);
    try {
      // The user picks where to save it; the app can only write to that one path.
      const path = await save({ defaultPath: "question-import-template.csv", filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (!path) return;
      // The byte-order mark makes Excel open the file as UTF-8 (the reader strips it again).
      await writeTextFile(path, "\uFEFF" + importTemplateCsv(choices[0]?.slug ?? "your-category-slug"));
      setSavedTemplate(true);
      setTimeout(() => setSavedTemplate(false), 3000);
    } catch (err) {
      setReadError(`Couldn't save the template: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function handleImport() {
    importQuestions.mutate(
      { questions: valid.map((r) => r.question!), submit: submitNow },
      { onSuccess: (count) => setImported(count) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <UploadIcon />
        Import
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import questions</DialogTitle>
          <DialogDescription>
            Upload a .csv or .xlsx file with one question per row. Every row is checked before anything is imported.
          </DialogDescription>
        </DialogHeader>

        {imported !== null ? (
          <div className="grid gap-4">
            <p className="text-sm">
              Imported {imported} question{imported === 1 ? "" : "s"}
              {submitNow ? " and sent them for review." : " as drafts."}
            </p>
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Input key={inputKey} type="file" accept=".csv,.xlsx" onChange={(e) => void handleFile(e)} disabled={reading || importQuestions.isPending} />
              {reading && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2Icon className="size-3.5 animate-spin" />
                  Reading {fileName}…
                </p>
              )}
              {readError && <p className="text-xs text-destructive">{readError}</p>}
              {preview?.fileError && <p className="text-xs text-destructive">{preview.fileError}</p>}
            </div>

            {!preview && !reading && <FormatGuide saved={savedTemplate} onDownload={() => void downloadTemplate()} />}

            {preview && !preview.fileError && (
              <>
                <p className="text-xs">
                  <span className="font-medium">{valid.length} ready to import</span>
                  {invalid > 0 && <span className="text-destructive">, {invalid} with problems (these will be skipped)</span>}
                  <span className="text-muted-foreground"> · {fileName}</span>
                </p>

                <div className="max-h-72 overflow-auto border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">Row</TableHead>
                        <TableHead>Title</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Difficulty</TableHead>
                        <TableHead className="w-16">Options</TableHead>
                        <TableHead>Result</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.rows.map((r) => (
                        <TableRow key={r.row}>
                          <TableCell className="text-muted-foreground">{r.row}</TableCell>
                          <TableCell className="max-w-44 truncate font-medium">{r.title || "—"}</TableCell>
                          <TableCell className="max-w-40 truncate text-muted-foreground">{r.category || "—"}</TableCell>
                          <TableCell className="capitalize">{r.difficulty || "—"}</TableCell>
                          <TableCell>{r.optionCount}</TableCell>
                          <TableCell className={r.error ? "text-destructive" : "text-muted-foreground"}>
                            {r.error ?? (
                              <span className="inline-flex items-center gap-1">
                                <CheckIcon className="size-3.5" /> Ready
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={submitNow}
                    onChange={(e) => setSubmitNow(e.target.checked)}
                    disabled={importQuestions.isPending}
                  />
                  Send them for review right away (otherwise they're saved as drafts)
                </label>

                {importQuestions.error && <p className="text-xs text-destructive">{importQuestions.error.message}</p>}

                <DialogFooter>
                  <Button variant="ghost" onClick={reset} disabled={importQuestions.isPending}>
                    Choose another file
                  </Button>
                  <Button onClick={handleImport} disabled={valid.length === 0 || importQuestions.isPending}>
                    {importQuestions.isPending ? "Importing…" : `Import ${valid.length} question${valid.length === 1 ? "" : "s"}`}
                  </Button>
                </DialogFooter>
              </>
            )}
          </div>
        )}
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
      <p className="text-muted-foreground">The first row must be a header. One question per row, up to {MAX_IMPORT_ROWS} per file.</p>
      <ul className="grid gap-1 text-muted-foreground">
        <li>
          <code>title</code>, <code>description</code> (markdown is fine)
        </li>
        <li>
          <code>category</code>: the category's slug or full path, e.g. <code>Aptitude › Algebra</code>
        </li>
        <li>
          <code>difficulty</code>: easy, medium (or med) or hard
        </li>
        <li>
          <code>correct</code>: the correct option's number or letter, e.g. <code>2</code> or <code>B</code>
        </li>
        <li>
          <code>option_1</code>, <code>explanation_1</code>, <code>option_2</code>, <code>explanation_2</code>, … at least 2 options, each with an
          explanation. Add as many <code>option_N</code> / <code>explanation_N</code> pairs as you need.
        </li>
      </ul>
      <p className="text-muted-foreground">The template has the header and two example rows. Open it in Excel or any spreadsheet app and replace the examples.</p>
    </div>
  );
}
