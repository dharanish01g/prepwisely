import { useEffect, useState, type FormEvent } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import logo from "@/assets/logo.png";

const REMEMBERED_EMAIL_KEY = "prepwisely.remembered-email";

function readRememberedEmail(): string {
  try {
    return localStorage.getItem(REMEMBERED_EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

export function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState(readRememberedEmail);
  const [remember, setRemember] = useState(() => readRememberedEmail() !== "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    const message = await signIn(email, password);
    // On success the auth state change swaps this screen out.
    if (message) {
      setError(message);
      setSubmitting(false);
      return;
    }
    try {
      if (remember) localStorage.setItem(REMEMBERED_EMAIL_KEY, email.trim());
      else localStorage.removeItem(REMEMBERED_EMAIL_KEY);
    } catch {
      // Storage unavailable: signing in still works, the email just isn't remembered.
    }
  }

  return (
    <main className="flex min-h-screen flex-col p-6">
      <div className="flex flex-1 items-center justify-center">
        <form noValidate onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-5">
          <div className="flex flex-col items-center gap-1 text-center">
            <img src={logo} alt="" className="mb-2 size-20 object-contain" />
            <h1 className="text-2xl font-semibold">prepwisely</h1>
            <p className="text-sm text-muted-foreground">Sign in to continue.</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email" className="font-medium">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              autoFocus={!email}
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              placeholder="you@example.com"
              disabled={submitting}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password" className="font-medium">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
            autoFocus={!!email}
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              disabled={submitting}
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="remember"
              checked={remember}
              onCheckedChange={setRemember}
              disabled={submitting}
            />
            <Label htmlFor="remember" className="cursor-pointer">
              Remember me
            </Label>
          </div>

          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" disabled={submitting || !email || !password}>
            {submitting && <Loader2Icon className="size-4 animate-spin" />}
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>

      <footer className="flex items-center justify-between gap-4 pt-6 text-[11px] text-muted-foreground">
        <span>prepwisely{version && ` v${version}`}</span>
        <span>&copy; {new Date().getFullYear()} Meikural Edu Tech India Private Limited. All rights reserved.</span>
      </footer>
    </main>
  );
}
