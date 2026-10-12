import * as React from "react"
import { cn } from "cn"

// macOS (WebKit) capitalises the first letter and autocorrects words as you type, which breaks slugs, method names,
// test values and emails. Off by default; a field can still turn them back on.
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-none border border-input bg-transparent px-2.5 py-2 text-xs transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 md:text-xs dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
