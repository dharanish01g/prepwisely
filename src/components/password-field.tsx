import { CopyIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { generatePassword } from "@/lib/faculty";

/** Copies text and confirms with a toast (or says it couldn't, so the user can copy it by hand). */
export async function copyText(text: string, what = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(what);
  } catch {
    toast.error("Couldn't copy. Select the text and copy it by hand.");
  }
}

interface PasswordFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
}

/** A visible password box with "generate another" and "copy" buttons, for passwords a manager hands out. */
export function PasswordField({ id, value, onChange }: PasswordFieldProps) {
  return (
    <InputGroup>
      <InputGroupInput id={id} autoComplete="off" spellCheck={false} className="font-mono" value={value} onChange={(e) => onChange(e.target.value)} />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" aria-label="Generate another password" title="Generate another" onClick={() => onChange(generatePassword())}>
          <RefreshCwIcon />
        </InputGroupButton>
        <InputGroupButton size="icon-xs" aria-label="Copy password" title="Copy" disabled={!value} onClick={() => void copyText(value, "Password copied")}>
          <CopyIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
