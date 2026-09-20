import { type FormEvent, useState } from "react";
import { CheckCircle2Icon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyRoleIds, useRoles } from "@/lib/roles";
import { changeMyPassword, useMyProfile } from "@/lib/profile";

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "").slice(0, 2);
  return letters.toUpperCase() || "?";
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xs">{value?.trim() || <span className="text-muted-foreground">Not provided</span>}</dd>
    </div>
  );
}

export function ProfileScreen() {
  const { data: profile, isPending, error } = useMyProfile();
  const { data: roleIds = [] } = useMyRoleIds();
  const { roleLabel } = useRoles();

  if (isPending) {
    return (
      <div className="flex max-w-2xl flex-col gap-6 p-4 pt-0">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="flex flex-1 flex-col gap-2 p-4 pt-0">
        <h1 className="text-2xl font-semibold">Profile</h1>
        <p className="text-sm text-destructive">Couldn't load your profile. Please try again.</p>
      </div>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-8 p-4 pt-0">
      <div>
        <h1 className="text-2xl font-semibold">Profile</h1>
        <p className="text-sm text-muted-foreground">Your account details and password.</p>
      </div>

      <div className="flex items-center gap-3">
        <Avatar size="lg">
          <AvatarFallback>{initialsOf(profile.full_name)}</AvatarFallback>
        </Avatar>
        <div className="grid gap-1">
          <p className="text-sm font-medium">{profile.full_name}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {roleIds.map((id) => (
              <Badge key={id} variant="secondary">
                {roleLabel(id)}
              </Badge>
            ))}
            {profile.status === "inactive" && <Badge variant="destructive">Inactive</Badge>}
          </div>
        </div>
      </div>

      <section className="grid gap-3">
        <div>
          <h2 className="text-base font-semibold">Your details</h2>
          <p className="text-xs text-muted-foreground">
            Your account is managed by prepwisely. To change any of these, contact support.
          </p>
        </div>
        <dl className="grid gap-4 border p-4 sm:grid-cols-2">
          <Field label="Full name" value={profile.full_name} />
          <Field label="Email" value={profile.email} />
          <Field label="Phone number" value={profile.phone} />
          <Field
            label="Member since"
            value={new Date(profile.created_at).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          />
          <div className="sm:col-span-2">
            <Field label="Address" value={profile.address} />
          </div>
        </dl>
      </section>

      <ChangePasswordSection />
    </div>
  );
}

function ChangePasswordSection() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setDone(false);
    try {
      await changeMyPassword(password, confirm);
      setPassword("");
      setConfirm("");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="grid gap-3">
      <div>
        <h2 className="text-base font-semibold">Change password</h2>
        <p className="text-xs text-muted-foreground">Choose a new password for signing in.</p>
      </div>
      <form noValidate onSubmit={handleSubmit} className="grid gap-4 border p-4">
        <div className="grid gap-1.5">
          <Label htmlFor="profile_new_password">New password</Label>
          <Input
            id="profile_new_password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="profile_confirm_password">Confirm new password</Label>
          <Input
            id="profile_confirm_password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
        {done && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2Icon className="size-3.5" /> Password updated.
          </p>
        )}

        <div>
          <Button type="submit" disabled={submitting || !password || !confirm}>
            {submitting ? "Updating…" : "Update password"}
          </Button>
        </div>
      </form>
    </section>
  );
}
