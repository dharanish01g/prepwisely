import { lazy, Suspense } from "react";
import type { CodeEditorProps } from "@/components/code-editor";

/** Matches the editor's own minimum height, so the page doesn't jump when it loads. */
const fallbackHeight = (lines: number) => lines * 20 + 20;

const CodeEditor = lazy(() => import("@/components/code-editor"));

/** The Monaco code editor, downloaded the first time one is shown. */
export function LazyCodeEditor(props: CodeEditorProps) {
  return (
    <Suspense
      fallback={
        <div className="border border-input p-3 text-xs text-muted-foreground" style={{ height: fallbackHeight(props.minLines ?? 15) }}>
          Loading editor…
        </div>
      }
    >
      <CodeEditor {...props} />
    </Suspense>
  );
}
