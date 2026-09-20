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
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarRail,
} from "@/components/ui/sidebar"
import { LogOutIcon } from "lucide-react"
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
  const { groups, loading } = useNav()
  const { data: myRoleIds = [] } = useMyRoleIds()
  const { roleLabel, loading: rolesLoading } = useRoles()
  const roleText = rolesLoading ? "" : myRoleIds.map(roleLabel).join(", ")

  const renderItem = (item: NavItem) => (
    <SidebarMenuItem key={item.id}>
      <SidebarMenuButton tooltip={item.title} isActive={activePage === item.id} onClick={() => onNavigate(item.id)}>
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
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg">
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
        ) : (
          groups.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarMenu>{group.items.map(renderItem)}</SidebarMenu>
            </SidebarGroup>
          ))
        )}
        {/* <NavMain items={data.navMain} /> */}
        {/* <NavProjects projects={data.projects} /> */}
      </SidebarContent>
      <SidebarFooter>
        {/* <NavUser user={currentUser} /> */}
        <SidebarMenu>
          {COMMON_ITEMS.map(renderItem)}
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Log out" onClick={() => void signOut()}>
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
