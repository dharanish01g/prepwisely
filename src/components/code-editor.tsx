import { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";
import "@/lib/monaco";

// A Monaco code editor (the editor VS Code uses) for a piece of code held in React state. Loaded lazily by its callers
// (see LazyCodeEditor below) so Monaco is only downloaded when a code box is shown.

/** prepwisely's dark mode is a `dark` class on <html>; follow it live. */
function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setDark(root.classList.contains("dark")));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** A Monaco language id: python, java, cpp, c, csharp, sql, ... */
  language: string;
  /** The box is at least this many lines tall, and grows with the code up to maxLines (then scrolls). */
  minLines?: number;
  maxLines?: number;
  readOnly?: boolean;
  ariaLabel?: string;
}

const FONT_SIZE = 13;
const LINE_HEIGHT = 20;
const PADDING = { top: 10, bottom: 10 };

/** The editor's height in pixels for a number of lines. */
export function linesHeight(lines: number) {
  return lines * LINE_HEIGHT + PADDING.top + PADDING.bottom;
}

export default function CodeEditor({ value, onChange, language, minLines = 15, maxLines = 40, readOnly, ariaLabel }: CodeEditorProps) {
  const dark = useIsDark();
  const [contentHeight, setContentHeight] = useState(0);
  const height = Math.min(Math.max(contentHeight, linesHeight(minLines)), linesHeight(maxLines));
  return (
    <div className="border border-input" style={{ height }}>
      <Editor
        value={value}
        language={language}
        theme={dark ? "vs-dark" : "vs"}
        onChange={(v) => onChange(v ?? "")}
        onMount={(editor) => {
          // Monaco types into a hidden textarea; stop macOS capitalising and autocorrecting code.
          const input = editor.getDomNode()?.querySelector("textarea");
          if (input) {
            input.setAttribute("autocapitalize", "off");
            input.setAttribute("autocorrect", "off");
            input.setAttribute("spellcheck", "false");
          }
          setContentHeight(editor.getContentHeight());
          editor.onDidContentSizeChange((e) => setContentHeight(e.contentHeight));
        }}
        loading={<p className="p-3 text-xs text-muted-foreground">Loading editor…</p>}
        options={{
          readOnly,
          ariaLabel,
          fontSize: FONT_SIZE,
          lineHeight: LINE_HEIGHT,
          tabSize: 4,
          insertSpaces: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          padding: PADDING,
          renderLineHighlight: "line",
          fixedOverflowWidgets: true,
        }}
      />
    </div>
  );
}
