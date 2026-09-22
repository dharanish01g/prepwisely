import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { Loader2Icon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { useUpdater } from "@/hooks/use-updater";
import { useTheme } from "@/hooks/use-theme";
import type { Theme } from "@/lib/theme";

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof SunIcon }[] = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
];

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="rounded-none border p-4">
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function UpdatesSection({ updater }: { updater: ReturnType<typeof useUpdater> }) {
  const { state, check, install, later } = updater;
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    void getVersion().then(setVersion);
  }, []);

  const checking = state.status === "checking";
  const downloading = state.status === "downloading";

  let status: string;
  switch (state.status) {
    case "idle":
      status = version ? `Version ${version}` : "";
      break;
    case "checking":
      status = "Checking for updates…";
      break;
    case "up-to-date":
      status = `You're up to date — version ${state.version}.`;
      break;
    case "error":
      status = state.message;
      break;
    case "downloading":
      status = `Downloading update ${state.version}…`;
      break;
    case "ready":
      status = `Update ${state.version} is ready to install.`;
      break;
    case "installing":
      status = "Installing update…";
      break;
  }

  return (
    <Section title="Updates" description="Check for and install the latest version.">
      <div className="flex items-center justify-between gap-4">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          {(checking || downloading || state.status === "installing") && <Loader2Icon className="size-3.5 animate-spin" />}
          {status}
        </p>
        {state.status === "ready" ? (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={later}>
              Later
            </Button>
            <Button size="sm" onClick={install}>
              Restart to update
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={check} disabled={checking || downloading}>
            Check for updates
          </Button>
        )}
      </div>
    </Section>
  );
}

export function SettingsScreen({ updater }: { updater: ReturnType<typeof useUpdater> }) {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex max-w-2xl flex-col gap-4 p-4 pt-0">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">App preferences.</p>
      </div>

      <Section title="Appearance" description="Choose how prepwisely looks on this device.">
        <div className="flex gap-2">
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <Button
              key={value}
              variant={theme === value ? "default" : "outline"}
              size="sm"
              onClick={() => setTheme(value)}
            >
              <Icon />
              {label}
            </Button>
          ))}
        </div>
      </Section>

      <UpdatesSection updater={updater} />
    </div>
  );
}
