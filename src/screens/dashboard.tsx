import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { AppSidebar } from "@/components/app-sidebar";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";

interface DashboardProps {
  onCheckForUpdates: () => void;
}

export function DashboardScreen({ onCheckForUpdates }: DashboardProps) {
  const { user } = useAuth();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion().then(setVersion).catch(console.error);
  }, []);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-auto" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage>Dashboard</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="ml-auto flex items-center gap-3 px-4">
            {version && <span className="text-xs text-muted-foreground">v{version}</span>}
            <Button variant="outline" size="sm" onClick={onCheckForUpdates}>
              Check for updates
            </Button>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-2 p-4 pt-0">
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Signed in as {user?.email}. More coming soon.</p>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
