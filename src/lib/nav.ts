import { useMemo } from "react";
import {
  BellIcon,
  BookOpenIcon,
  Building2Icon,
  CalendarClockIcon,
  ChartColumnIcon,
  ChartLineIcon,
  ClipboardCheckIcon,
  ClipboardListIcon,
  DownloadIcon,
  FileBarChartIcon,
  FileTextIcon,
  GraduationCapIcon,
  HistoryIcon,
  InboxIcon,
  LayersIcon,
  LayoutDashboardIcon,
  LibraryIcon,
  LifeBuoyIcon,
  MessageSquareIcon,
  NetworkIcon,
  PenLineIcon,
  PlusIcon,
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
import { useMyRoleIds } from "@/lib/roles";

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
        item("user-management", "User Management", UsersIcon),
        item("settings", "Settings", Settings2Icon),
      ],
    },
    { label: "Content Management", items: [item("categories", "Categories", LayersIcon)] },
  ],
  content_manager: [
    {
      label: "Content",
      items: [
        item("content-dashboard", "Content dashboard", LayoutDashboardIcon),
        item("briefs", "Briefs & targets", TargetIcon),
        item("question-bank", "Question bank", LibraryIcon),
        item("content-reports", "Reports", FileBarChartIcon),
      ],
    },
    { label: "Team", items: [item("content-team", "Content team", UsersIcon)] },
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
  ],
  onboarding_manager: [
    {
      label: "Colleges",
      items: [
        item("my-colleges", "My colleges", Building2Icon),
        item("add-college", "Add college", PlusIcon),
        item("depts-batches", "Depts & batches", NetworkIcon),
      ],
    },
    {
      label: "People",
      items: [
        item("college-users", "Users", UsersIcon),
        item("bulk-import", "Bulk student import", UploadIcon),
      ],
    },
    { label: "Tests", items: [item("test-schedule", "Test schedule", CalendarClockIcon)] },
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
];

// A user can hold several roles: show every role's groups, and never repeat a page.
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

export function useNav() {
  const { data: roleIds, isPending } = useMyRoleIds();
  const groups = useMemo(() => buildNav(roleIds ?? []), [roleIds]);
  return { groups, loading: isPending };
}

export function findNavItem(groups: NavGroup[], id: string): NavItem | undefined {
  return [...groups.flatMap((g) => g.items), ...COMMON_ITEMS].find((i) => i.id === id);
}
