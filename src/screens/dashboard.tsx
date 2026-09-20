import { useMemo, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { COMMON_ITEMS, findNavItem, useNav } from "@/lib/nav";
import { CategoriesScreen } from "@/screens/categories";
import { ComingSoonScreen } from "@/screens/coming-soon";
import { UserManagementScreen } from "@/screens/user-management";

export function DashboardScreen() {
  const { user } = useAuth();
  const { groups, loading } = useNav();
  const [requested, setRequested] = useState<string | null>(null);

  // Only pages in the user's own sidebar are reachable; anything else falls back to their first page.
  const allowed = useMemo(
    () => new Set([...groups.flatMap((g) => g.items), ...COMMON_ITEMS].map((i) => i.id)),
    [groups],
  );
  const landing = groups[0]?.items[0]?.id ?? COMMON_ITEMS[0].id;
  const page = requested && allowed.has(requested) ? requested : landing;
  const title = findNavItem(groups, page)?.title ?? "";

  return (
    <SidebarProvider>
      <AppSidebar activePage={page} onNavigate={setRequested} />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-auto" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage>{title}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : page === "user-management" ? (
          <UserManagementScreen />
        ) : page === "categories" ? (
          <CategoriesScreen />
        ) : page === "dashboard" ? (
          <div className="flex flex-1 flex-col gap-2 p-4 pt-0">
            <h1 className="text-2xl font-semibold">Dashboard</h1>
            <p className="text-sm text-muted-foreground">Signed in as {user?.email}. More coming soon.</p>
          </div>
        ) : (
          <ComingSoonScreen title={title} />
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}
