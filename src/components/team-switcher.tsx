"use client"

import * as React from "react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { CheckIcon, ChevronsUpDownIcon, type LucideIcon } from "lucide-react"

export interface SwitcherRole {
  id: string
  label: string
  icon: LucideIcon
}

// Sidebar header for a user with more than one role (e.g. faculty + TPO on one login): the logo and the role they're
// working as, opening a list of only their own roles. Picking one swaps the sidebar to that role's pages.
export function TeamSwitcher({
  name,
  logo,
  roles,
  activeRoleId,
  onSwitch,
  disabled = false,
}: {
  name: string
  logo: React.ReactNode
  roles: SwitcherRole[]
  activeRoleId: string | undefined
  onSwitch: (roleId: string) => void
  disabled?: boolean
}) {
  const { isMobile } = useSidebar()
  const active = roles.find((r) => r.id === activeRoleId)

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={disabled}
            render={
              <SidebarMenuButton
                size="lg"
                className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
              />
            }
          >
            <div className="flex aspect-square size-8 items-center justify-center">
              {logo}
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{name}</span>
              <span className="truncate text-xs text-muted-foreground">{active?.label ?? ""}</span>
            </div>
            <ChevronsUpDownIcon className="ml-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-fit"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Switch role
              </DropdownMenuLabel>
              {roles.map((role) => (
                <DropdownMenuItem
                  key={role.id}
                  onClick={() => role.id !== activeRoleId && onSwitch(role.id)}
                  className="gap-2 p-2"
                >
                  <div className="flex size-6 items-center justify-center border">
                    <role.icon className="size-3.5" />
                  </div>
                  {role.label}
                  {role.id === activeRoleId && <CheckIcon className="ml-auto" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
