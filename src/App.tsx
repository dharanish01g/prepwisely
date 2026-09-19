import { Loader2Icon } from "lucide-react";
import { UpdateBanner } from "@/components/update-banner";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { useUpdater } from "@/hooks/use-updater";
import { DashboardScreen } from "@/screens/dashboard";
import { LoginScreen } from "@/screens/login";
import "./App.css";

function Screens({ onCheckForUpdates }: { onCheckForUpdates: () => void }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
      </main>
    );
  }

  return user ? <DashboardScreen onCheckForUpdates={onCheckForUpdates} /> : <LoginScreen />;
}

function App() {
  const updater = useUpdater();

  return (
    <AuthProvider>
      <Screens onCheckForUpdates={updater.check} />
      <UpdateBanner state={updater.state} onInstall={updater.install} onDismiss={updater.dismiss} />
    </AuthProvider>
  );
}

export default App;
