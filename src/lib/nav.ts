import { useMemo, useSyncExternalStore } from "react";
import { onlineManager } from "@tanstack/react-query";
import {
  BellIcon,
  BookOpenIcon,
  BriefcaseIcon,
  Building2Icon,
  CalendarClockIcon,
  ChartColumnIcon,
  ChartLineIcon,
  CircleHelpIcon,
  ClipboardCheckIcon,
  ClipboardListIcon,
  DownloadIcon,
  FileBarChartIcon,
  FileTextIcon,
  GraduationCapIcon,
  HistoryIcon,
  InboxIcon,
  LayersIcon,
  LayoutGridIcon,
  LayoutDashboardIcon,
  LibraryIcon,
  LifeBuoyIcon,
  ListOrderedIcon,
  MessageSquareIcon,
  NetworkIcon,
  PenLineIcon,
  PresentationIcon,
  ScrollTextIcon,
  SearchIcon,
  Settings2Icon,
  TargetIcon,
  UploadIcon,
  UserIcon,
  UsersIcon,
  WrenchIcon,
  CirclePlayIcon,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { saveActiveRole, useMyRoleIds, useSavedActiveRole } from "@/lib/roles";

export interface NavItem {
  id: string;
  title: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

const item = (id: string, title: string, icon: LucideIcon): NavItem => ({ id, title, icon });

// What each company-side role does and which pages it has (content in src/lib/help.ts).
const HELP = item("help", "Help", CircleHelpIcon);

// Sidebar contents per role (see SIDEBAR.md). This only decides which links to show; what a user can
// actually read or change is enforced by RLS. Keys are role ids from public.roles. A role not listed
// here contributes no links.
const NAV_BY_ROLE: Record<string, NavGroup[]> = {
  superadmin: [
    {
      label: "Monitoring",
      items: [
        item("dashboard", "Overview", LayoutDashboardIcon),
        item("platform-analytics", "Platform analytics", ChartColumnIcon),
        item("audit-log", "Audit log", ScrollTextIcon),
      ],
    },
    {
      label: "Platform Management",
      items: [
        item("colleges", "Colleges", Building2Icon),
        item("depts-batches", "Depts & batches", NetworkIcon),
        item("faculty", "Faculty", PresentationIcon),
        item("tpo", "TPO", BriefcaseIcon),
        item("user-management", "User Management", UsersIcon),
      ],
    },
    {
      label: "Tests",
      items: [item("tests", "Tests", ClipboardListIcon), item("test-series", "Test series", ListOrderedIcon)],
    },
    // Superadmin also runs content (the database already grants it everything a content manager can do).
    {
      label: "Content Management",
      items: [
        item("categories", "Categories", LayersIcon),
        item("practice", "Practice", LayoutGridIcon),
        item("briefs", "Briefs & targets", TargetIcon),
        item("question-bank", "Question bank", LibraryIcon),
        item("content-team", "Content team", UsersIcon),
        item("quality-guidelines", "Quality guidelines", BookOpenIcon),
      ],
    },
    { label: "Reference", items: [HELP] },
  ],
  content_manager: [
    {
      label: "Content",
      items: [
        item("content-dashboard", "Content dashboard", LayoutDashboardIcon),
        item("practice", "Practice", LayoutGridIcon),
        item("briefs", "Briefs & targets", TargetIcon),
        item("question-bank", "Question bank", LibraryIcon),
        item("content-reports", "Reports", FileBarChartIcon),
      ],
    },
    { label: "Team", items: [item("content-team", "Content team", UsersIcon)] },
    { label: "Reference", items: [item("quality-guidelines", "Quality guidelines", BookOpenIcon), HELP] },
  ],
  content_creator: [
    {
      label: "Writing",
      items: [
        item("my-assignments", "My assignments", ClipboardListIcon),
        item("write-question", "Write question", PenLineIcon),
        item("my-questions", "My questions", FileTextIcon),
        item("reviewer-feedback", "Reviewer feedback", MessageSquareIcon),
      ],
    },
    { label: "Reference", items: [item("quality-guidelines", "Quality guidelines", BookOpenIcon), HELP] },
  ],
  content_reviewer: [
    {
      label: "Review",
      items: [
        item("review-queue", "Review queue", InboxIcon),
        item("review-history", "Reviewed history", HistoryIcon),
        item("question-bank", "Question bank", LibraryIcon),
        item("quality-guidelines", "Quality guidelines", BookOpenIcon),
      ],
    },
    { label: "Reference", items: [HELP] },
  ],
  onboarding_manager: [
    {
      label: "Colleges",
      items: [
        item("my-colleges", "My colleges", Building2Icon),
        item("depts-batches", "Depts & batches", NetworkIcon),
      ],
    },
    {
      label: "People",
      items: [
        item("faculty", "Faculty", PresentationIcon),
        item("tpo", "TPO", BriefcaseIcon),
        item("bulk-import", "Bulk student import", UploadIcon),
      ],
    },
    {
      label: "Tests",
      items: [
        item("tests", "Tests", ClipboardListIcon),
        item("test-series", "Test series", ListOrderedIcon),
        item("test-schedule", "Test schedule", CalendarClockIcon),
      ],
    },
    { label: "Reference", items: [HELP] },
  ],
  support: [
    {
      label: "Support",
      items: [
        item("tickets", "Tickets", LifeBuoyIcon),
        item("support-search", "Search", SearchIcon),
        item("account-actions", "Account actions", WrenchIcon),
        item("support-log", "My action log", ScrollTextIcon),
      ],
    },
    { label: "Reference", items: [HELP] },
  ],
  tpo: [
    {
      label: "Analytics",
      items: [
        item("tpo-overview", "Today's overview", LayoutDashboardIcon),
        item("departments", "Departments", Building2Icon),
        item("batches", "Batches", GraduationCapIcon),
        item("students", "Students", UsersIcon),
        item("daily-results", "Daily results", ClipboardCheckIcon),
        item("export-reports", "Export reports", DownloadIcon),
      ],
    },
  ],
  faculty: [
    {
      label: "My Batches",
      items: [
        item("my-batches", "My batches", GraduationCapIcon),
        item("faculty-results", "Today's results", ClipboardCheckIcon),
        item("student-analytics", "Student analytics", ChartLineIcon),
        item("faculty-reports", "Reports", DownloadIcon),
      ],
    },
  ],
  student: [
    {
      label: "Tests",
      items: [
        item("todays-test", "Today's test", CirclePlayIcon),
        item("my-results", "My results", ClipboardCheckIcon),
        item("my-analytics", "My analytics", ChartLineIcon),
      ],
    },
  ],
};

/** Shown to every role, below the role-specific groups. */
export const COMMON_ITEMS: NavItem[] = [
  item("profile", "Profile", UserIcon),
  item("notifications", "Notifications", BellIcon),
  item("settings", "Settings", Settings2Icon),
];

// Builds the sidebar from the given roles' groups, never repeating a page. The app passes one role: a user with
// several roles sees the one they switched to (see useActiveRole).
function buildNav(roleIds: string[]): NavGroup[] {
  const seen = new Set<string>();
  const groups: NavGroup[] = [];
  for (const [roleId, roleGroups] of Object.entries(NAV_BY_ROLE)) {
    if (!roleIds.includes(roleId)) continue;
    for (const group of roleGroups) {
      const items = group.items.filter((i) => !seen.has(i.id));
      items.forEach((i) => seen.add(i.id));
      if (items.length) groups.push({ label: group.label, items });
    }
  }
  return groups;
}

/** One role's own sidebar pages, in sidebar order (Help lists these per role). */
export function roleNavItems(roleId: string): NavItem[] {
  return (NAV_BY_ROLE[roleId] ?? []).flatMap((g) => g.items);
}

/**
 * The user's roles in sidebar order (e.g. tpo before faculty) and the one they're working as: their saved choice
 * if they still hold it, else the first. `switchable` is true only with more than one role.
 */
export function useActiveRole() {
  const { user } = useAuth();
  const { data: roleIds } = useMyRoleIds();
  const saved = useSavedActiveRole();
  const known = Object.keys(NAV_BY_ROLE);
  const ordered = [...known.filter((r) => roleIds?.includes(r)), ...(roleIds ?? []).filter((r) => !known.includes(r))];
  const activeRoleId = saved && ordered.includes(saved) ? saved : ordered[0];
  return {
    roleIds: ordered,
    activeRoleId,
    switchable: ordered.length > 1,
    setActiveRole: (roleId: string) => user && saveActiveRole(user.id, roleId),
  };
}

/** Live browser online/offline state (the same signal React Query uses to pause requests). */
export function useOnline() {
  return useSyncExternalStore(
    (onChange) => onlineManager.subscribe(onChange),
    () => onlineManager.isOnline(),
  );
}

// Failed requests with no server response ("Failed to fetch", Safari's "Load failed", ...) mean no connection.
const isNetworkError = (error: unknown) =>
  error instanceof Error ? /fetch|network|load failed/i.test(error.message) : false;

export function useNav() {
  const { data: roleIds, isPending, isError, error, isFetching, refetch } = useMyRoleIds();
  const { activeRoleId } = useActiveRole();
  const online = useOnline();
  const groups = useMemo(() => buildNav(activeRoleId ? [activeRoleId] : []), [activeRoleId]);
  // `online` covers a dropped connection; the query error covers wifi that is up but has no internet.
  const offline = !online || (isError && isNetworkError(error));
  return {
    groups,
    /** True only while there's nothing to show yet and a request is actually able to run. */
    loading: isPending && !offline,
    offline,
    /** Roles couldn't be loaded for a reason other than being offline; `retry` tries again. */
    failed: isError && !offline,
    /** Roles finished loading and this user has none. */
    noAccess: roleIds !== undefined && roleIds.length === 0 && !isError,
    retrying: isFetching,
    retry: () => void refetch(),
  };
}

export function findNavItem(groups: NavGroup[], id: string): NavItem | undefined {
  return [...groups.flatMap((g) => g.items), ...COMMON_ITEMS].find((i) => i.id === id);
}
