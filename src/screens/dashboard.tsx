import { useMemo, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { ConnectionBanner } from "@/components/connection-banner";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { COMMON_ITEMS, findNavItem, useNav } from "@/lib/nav";
import { BriefsScreen } from "@/screens/briefs";
import { CategoriesScreen } from "@/screens/categories";
import { ComingSoonScreen } from "@/screens/coming-soon";
import { ContentTeamScreen } from "@/screens/content-team";
import { MyAssignmentsScreen } from "@/screens/my-assignments";
import { MyQuestionsScreen } from "@/screens/my-questions";
import { ProfileScreen } from "@/screens/profile";
import { QualityGuidelinesScreen } from "@/screens/quality-guidelines";
import { QuestionBankScreen } from "@/screens/question-bank";
import { ReviewHistoryScreen } from "@/screens/review-history";
import { ReviewQueueScreen } from "@/screens/review-queue";
import { UserManagementScreen } from "@/screens/user-management";
import { WriteQuestionScreen } from "@/screens/write-question";

export function DashboardScreen() {
  const { user } = useAuth();
  const { groups, loading, offline, failed, retrying, retry } = useNav();
  const [requested, setRequested] = useState<string | null>(null);
  // The question open in the editor (null = a new one). The key remounts the editor so that clicking
  // "Write question" in the sidebar always starts from a blank form.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  // Set when the editor was opened from a brief ("My assignments" → Write a question).
  const [editorBriefId, setEditorBriefId] = useState<string | null>(null);

  // Only pages in the user's own sidebar are reachable; anything else falls back to their first page.
  const allowed = useMemo(
    () => new Set([...groups.flatMap((g) => g.items), ...COMMON_ITEMS].map((i) => i.id)),
    [groups],
  );
  const landing = groups[0]?.items[0]?.id ?? COMMON_ITEMS[0].id;
  const page = requested && allowed.has(requested) ? requested : landing;
  const title = findNavItem(groups, page)?.title ?? "";

  function navigate(next: string) {
    setEditingId(null);
    setEditorBriefId(null);
    setEditorKey((k) => k + 1);
    setRequested(next);
  }

  function writeForBrief(briefId: string) {
    setEditingId(null);
    setEditorBriefId(briefId);
    setEditorKey((k) => k + 1);
    setRequested("write-question");
  }

  function openEditor(questionId: string) {
    setEditingId(questionId);
    setEditorBriefId(null);
    setEditorKey((k) => k + 1);
    setRequested("write-question");
  }

  return (
    <SidebarProvider>
      <AppSidebar activePage={page} onNavigate={navigate} />
      <SidebarInset>
        <ConnectionBanner offline={offline} failed={failed} retrying={retrying} onRetry={retry} />
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
        ) : page === "profile" ? (
          <ProfileScreen />
        ) : page === "categories" ? (
          <CategoriesScreen />
        ) : page === "write-question" ? (
          <WriteQuestionScreen key={editorKey} questionId={editingId} defaultBriefId={editorBriefId} onDone={() => navigate("my-questions")} />
        ) : page === "briefs" ? (
          <BriefsScreen />
        ) : page === "content-team" ? (
          <ContentTeamScreen />
        ) : page === "my-assignments" ? (
          <MyAssignmentsScreen onWrite={writeForBrief} />
        ) : page === "my-questions" ? (
          <MyQuestionsScreen mode="all" onEdit={openEditor} />
        ) : page === "review-queue" ? (
          <ReviewQueueScreen />
        ) : page === "review-history" ? (
          <ReviewHistoryScreen />
        ) : page === "question-bank" ? (
          <QuestionBankScreen />
        ) : page === "reviewer-feedback" ? (
          <MyQuestionsScreen mode="feedback" onEdit={openEditor} />
        ) : page === "quality-guidelines" ? (
          <QualityGuidelinesScreen />
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
