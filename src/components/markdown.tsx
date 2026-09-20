import { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// Raw HTML is not rendered (react-markdown's default). Links open in the system browser, never inside the
// app window, and images are not loaded: only their alt text is shown.
const components: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href && /^https?:\/\//i.test(href)) void openUrl(href);
      }}
    >
      {children}
    </a>
  ),
  img: ({ alt }) => <span>{alt}</span>,
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("markdown", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

interface MarkdownFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
}

/** A textarea for markdown with a Write / Preview switch. */
export function MarkdownField({ id, label, value, onChange, rows = 3, placeholder, disabled }: MarkdownFieldProps) {
  const [preview, setPreview] = useState(false);

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        <div className="flex gap-1">
          <Button type="button" size="xs" variant={preview ? "ghost" : "secondary"} onClick={() => setPreview(false)}>
            Write
          </Button>
          <Button type="button" size="xs" variant={preview ? "secondary" : "ghost"} onClick={() => setPreview(true)}>
            Preview
          </Button>
        </div>
      </div>
      {preview ? (
        <div className="min-h-16 border border-input px-2.5 py-2">
          {value.trim() ? <Markdown>{value}</Markdown> : <p className="text-xs text-muted-foreground">Nothing to preview.</p>}
        </div>
      ) : (
        <Textarea
          id={id}
          rows={rows}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
