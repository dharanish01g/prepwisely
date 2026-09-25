"use client"

import * as React from "react"

// import { NavMain } from "@/components/nav-main"
// import { NavProjects } from "@/components/nav-projects"
// import { NavUser } from "@/components/nav-user"
// import { TeamSwitcher } from "@/components/team-switcher"
import { useAuth } from "@/hooks/use-auth"
import { COMMON_ITEMS, useNav, type NavItem } from "@/lib/nav"
import { useMyRoleIds, useRoles } from "@/lib/roles"
import logo from "@/assets/logo.png"
import { Calendar } from "@/components/ui/calendar"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar"
import { CalendarIcon, LogOutIcon } from "lucide-react"
// import { AudioLinesIcon, TerminalIcon } from "lucide-react"
// import { TerminalSquareIcon, BotIcon, BookOpenIcon, Settings2Icon, FrameIcon, PieChartIcon, MapIcon } from "lucide-react"

// Sample data (team switcher, nav, projects), commented out for now; reuse later.
/*
const data = {
  teams: [
    {
      name: "prepwisely.in",
      logo: <img src={logo} alt="" className="size-full object-contain" />,
      plan: "Superadmin",
    },
    {
      name: "Acme Corp.",
      logo: (
        <AudioLinesIcon
        />
      ),
      plan: "Startup",
    },
    {
      name: "Evil Corp.",
      logo: (
        <TerminalIcon
        />
      ),
      plan: "Free",
    },
  ],
  navMain: [
    {
      title: "Playground",
      url: "#",
      icon: (
        <TerminalSquareIcon
        />
      ),
      isActive: true,
      items: [
        {
          title: "History",
          url: "#",
        },
        {
          title: "Starred",
          url: "#",
        },
        {
          title: "Settings",
          url: "#",
        },
      ],
    },
    {
      title: "Models",
      url: "#",
      icon: (
        <BotIcon
        />
      ),
      items: [
        {
          title: "Genesis",
          url: "#",
        },
        {
          title: "Explorer",
          url: "#",
        },
        {
          title: "Quantum",
          url: "#",
        },
      ],
    },
    {
      title: "Documentation",
      url: "#",
      icon: (
        <BookOpenIcon
        />
      ),
      items: [
        {
          title: "Introduction",
          url: "#",
        },
        {
          title: "Get Started",
          url: "#",
        },
        {
          title: "Tutorials",
          url: "#",
        },
        {
          title: "Changelog",
          url: "#",
        },
      ],
    },
    {
      title: "Settings",
      url: "#",
      icon: (
        <Settings2Icon
        />
      ),
      items: [
        {
          title: "General",
          url: "#",
        },
        {
          title: "Team",
          url: "#",
        },
        {
          title: "Billing",
          url: "#",
        },
        {
          title: "Limits",
          url: "#",
        },
      ],
    },
  ],
  projects: [
    {
      name: "Design Engineering",
      url: "#",
      icon: (
        <FrameIcon
        />
      ),
    },
    {
      name: "Sales & Marketing",
      url: "#",
      icon: (
        <PieChartIcon
        />
      ),
    },
    {
      name: "Travel",
      url: "#",
      icon: (
        <MapIcon
        />
      ),
    },
  ],
}
*/

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  activePage: string
  onNavigate: (page: string) => void
}

export function AppSidebar({ activePage, onNavigate, ...props }: AppSidebarProps) {
  const { signOut } = useAuth()
  const { groups, loading, offline, noAccess } = useNav()
  const { data: myRoleIds = [] } = useMyRoleIds()
  const { roleLabel, loading: rolesLoading } = useRoles()
  const roleText = rolesLoading ? "" : myRoleIds.map(roleLabel).join(", ")
  const [date, setDate] = React.useState<Date | undefined>(new Date())
  const { toggleSidebar } = useSidebar()

  const renderItem = (item: NavItem) => (
    <SidebarMenuItem key={item.id}>
      <SidebarMenuButton
        tooltip={item.title}
        isActive={activePage === item.id}
        // Not `disabled`: the tooltip trigger swallows that prop and never sets it on the button.
        aria-disabled={offline || undefined}
        tabIndex={offline ? -1 : undefined}
        className={offline ? "pointer-events-none opacity-50" : undefined}
        onClick={() => {
          if (!offline) onNavigate(item.id)
        }}
      >
        <item.icon />
        <span>{item.title}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
  // const { user } = useAuth()
  // const email = user?.email ?? ""
  // const currentUser = {
  //   name: email.split("@")[0] || "User",
  //   email,
  //   avatar: "",
  // }

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        {/* <TeamSwitcher teams={data.teams} /> */}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<div />}
              className="cursor-default hover:bg-transparent hover:text-inherit active:bg-transparent"
            >
              <div className="flex aspect-square size-8 items-center justify-center">
                <img src={logo} alt="" className="size-full object-contain" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">prepwisely.in</span>
                <span className="truncate text-xs text-muted-foreground">{roleText}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarSeparator className="mx-0" />
      <SidebarGroup className="px-0 group-data-[collapsible=icon]:hidden">
        <SidebarGroupContent>
          <Calendar
            mode="single"
            selected={date}
            onSelect={setDate}
            captionLayout="dropdown"
            className="bg-transparent [--cell-size:2.1rem]"
          />
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup className="hidden group-data-[collapsible=icon]:block">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Calendar" onClick={toggleSidebar}>
              <CalendarIcon />
              <span>Calendar</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
      <SidebarSeparator className="mx-0" />
      <SidebarContent>
        {loading ? (
          <SidebarGroup>
            <SidebarMenu>
              {[0, 1, 2, 3].map((i) => (
                <SidebarMenuItem key={i}>
                  <SidebarMenuSkeleton showIcon />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ) : noAccess ? (
          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <p className="px-2 text-xs text-muted-foreground">No pages are assigned to your account yet. Contact support.</p>
          </SidebarGroup>
        ) : (
          groups.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarMenu>{group.items.map(renderItem)}</SidebarMenu>
            </SidebarGroup>
          ))
        )}
        <SidebarGroup>
          <SidebarGroupLabel>Account</SidebarGroupLabel>
          <SidebarMenu>{COMMON_ITEMS.map(renderItem)}</SidebarMenu>
        </SidebarGroup>
        {/* <NavMain items={data.navMain} /> */}
        {/* <NavProjects projects={data.projects} /> */}
      </SidebarContent>
      <SidebarFooter>
        {/* <NavUser user={currentUser} /> */}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Log out"
              onClick={() => void signOut()}
              className="bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive active:bg-destructive/20 active:text-destructive dark:bg-destructive/20 dark:hover:bg-destructive/30"
            >
              <LogOutIcon />
              <span>Log out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
