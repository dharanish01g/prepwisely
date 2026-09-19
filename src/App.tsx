import { useEffect } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { UpdateBanner } from "@/components/update-banner";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { useUpdater } from "@/hooks/use-updater";
import { DashboardScreen } from "@/screens/dashboard";
import { LoginScreen } from "@/screens/login";
import "./App.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
});

function Screens() {
  const { user, loading } = useAuth();
  const queryClient = useQueryClient();

  // Drop cached data on sign-out so the next user never sees the previous user's data.
  useEffect(() => {
    if (!loading && !user) queryClient.clear();
  }, [loading, user, queryClient]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
      </main>
    );
  }

  return user ? <DashboardScreen /> : <LoginScreen />;
}

function App() {
  const updater = useUpdater();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Screens />
        <UpdateBanner state={updater.state} onInstall={updater.install} onDismiss={updater.dismiss} />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
