import { type ChangeEvent, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { CheckIcon, DownloadIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { readImportFile } from "@/lib/question-import";
import {
  batchPassword,
  buildStudentImportPreview,
  ImportRejected,
  MAX_STUDENT_IMPORT_ROWS,
  type StudentImportPreview,
  studentTemplateCsv,
  useImportStudents,
} from "@/lib/students";

interface ImportStudentsDialogProps {
  open: boolean;
  batchId: string;
  batchCode: string;
  collegeId: string;
  onClose: () => void;
}

// All or nothing, like the server: the import only runs when every row is valid, and if the server still finds a
// problem (e.g. an email already used by another account) nothing is imported and its errors show against the rows.
export function ImportStudentsDialog({ open, batchId, batchCode, collegeId, onClose }: ImportStudentsDialogProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<StudentImportPreview | null>(null);
  const [serverErrors, setServerErrors] = useState<Map<number, string>>(new Map());
  const [readError, setReadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [imported, setImported] = useState<number | null>(null);
  const [savedTemplate, setSavedTemplate] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const importStudents = useImportStudents(batchId, collegeId);

  const rows = (preview?.rows ?? []).map((r) => ({ ...r, error: r.error ?? serverErrors.get(r.row) ?? null }));
  const invalid = rows.filter((r) => r.error).length;

  function reset() {
    setFileName(null);
    setPreview(null);
    setServerErrors(new Map());
    setReadError(null);
    setImported(null);
    setInputKey((k) => k + 1);
    importStudents.reset();
  }

  function close() {
    reset();
    onClose();
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    reset();
    setFileName(file.name);
    setReading(true);
    try {
      setPreview(buildStudentImportPreview(await readImportFile(file)));
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
      const path = await save({ defaultPath: "student-import-template.csv", filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (!path) return;
      // The byte-order mark makes Excel open the file as UTF-8 (the reader strips it again).
      await writeTextFile(path, "﻿" + studentTemplateCsv());
      setSavedTemplate(true);
      setTimeout(() => setSavedTemplate(false), 3000);
    } catch (err) {
      setReadError(`Couldn't save the template: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function handleImport() {
    importStudents.mutate(rows, {
      onSuccess: (count) => setImported(count),
      onError: (err) => {
        if (err instanceof ImportRejected) setServerErrors(new Map(err.rowErrors.map((e) => [e.row, e.message])));
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import students into {batchCode}</DialogTitle>
          <DialogDescription>
            Upload a .csv or .xlsx file with one student per row. Every row is checked first, and nothing is imported until all rows are valid.
          </DialogDescription>
        </DialogHeader>

        {imported !== null ? (
          <div className="grid gap-4">
            <p className="text-sm">
              Imported {imported} student{imported === 1 ? "" : "s"}. They sign in with their email, and their first password is{" "}
              <span className="font-medium">{batchPassword(batchCode)}</span>.
            </p>
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Input key={inputKey} type="file" accept=".csv,.xlsx" onChange={(e) => void handleFile(e)} disabled={reading || importStudents.isPending} />
              {reading && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2Icon className="size-3.5 animate-spin" />
                  Reading {fileName}…
                </p>
              )}
              {readError && <p className="text-xs text-destructive">{readError}</p>}
              {preview?.fileError && <p className="text-xs text-destructive">{preview.fileError}</p>}
            </div>

            {!preview && !reading && (
              <FormatGuide password={batchPassword(batchCode)} saved={savedTemplate} onDownload={() => void downloadTemplate()} />
            )}

            {preview && !preview.fileError && (
              <>
                <p className="text-xs">
                  {invalid > 0 ? (
                    <span className="text-destructive">
                      {invalid} row{invalid === 1 ? "" : "s"} with problems. Fix {invalid === 1 ? "it" : "them"} in the file and choose it again.
                    </span>
                  ) : (
                    <span className="font-medium">All {rows.length} rows are ready to import</span>
                  )}
                  <span className="text-muted-foreground"> · {fileName}</span>
                </p>

                <div className="max-h-72 overflow-auto border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">Row</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Roll number</TableHead>
                        <TableHead>Result</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.row}>
                          <TableCell className="text-muted-foreground">{r.row}</TableCell>
                          <TableCell className="max-w-40 truncate font-medium">{r.full_name || "—"}</TableCell>
                          <TableCell className="max-w-48 truncate text-muted-foreground">{r.email || "—"}</TableCell>
                          <TableCell>{r.roll_number || "—"}</TableCell>
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

                {importStudents.error && <p className="text-xs text-destructive">{importStudents.error.message}</p>}

                <DialogFooter>
                  <Button variant="ghost" onClick={reset} disabled={importStudents.isPending}>
                    Choose another file
                  </Button>
                  <Button onClick={handleImport} disabled={invalid > 0 || rows.length === 0 || importStudents.isPending}>
                    {importStudents.isPending ? "Importing…" : `Import ${rows.length} student${rows.length === 1 ? "" : "s"}`}
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

function FormatGuide({ password, saved, onDownload }: { password: string; saved: boolean; onDownload: () => void }) {
  return (
    <div className="grid gap-2 border p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">File format</p>
        <Button type="button" variant="outline" size="xs" onClick={onDownload}>
          {saved ? <CheckIcon /> : <DownloadIcon />}
          {saved ? "Saved" : "Download CSV template"}
        </Button>
      </div>
      <p className="text-muted-foreground">
        The first row must be a header. One student per row, up to {MAX_STUDENT_IMPORT_ROWS} per file.
      </p>
      <ul className="grid gap-1 text-muted-foreground">
        <li>
          <code>full_name</code>
        </li>
        <li>
          <code>email</code>: the student signs in with it; it must not be used by any other account
        </li>
        <li>
          <code>roll_number</code>: unique in the college
        </li>
        <li>
          <code>phone</code> (optional): leave the cell blank, or leave the column out
        </li>
      </ul>
      <p className="text-muted-foreground">
        Every student's first password is the batch code without dashes, <span className="font-medium text-foreground">{password}</span>.
      </p>
      <p className="text-muted-foreground">The template has the header and two example rows. Open it in Excel or any spreadsheet app and replace the examples.</p>
    </div>
  );
}
