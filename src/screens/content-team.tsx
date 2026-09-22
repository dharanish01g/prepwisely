import { useMemo, useState } from "react";
import { KeyRoundIcon, PencilIcon, SearchIcon } from "lucide-react";
import { AddUserDialog } from "@/components/add-user-dialog";
import { EditUserDialog } from "@/components/edit-user-dialog";
import { ResetPasswordDialog } from "@/components/reset-password-dialog";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserStatusButton } from "@/components/user-status-button";
import { useRoles } from "@/lib/roles";
import { CONTENT_TEAM_ROLE_IDS, type StaffUser, useUsers } from "@/lib/users";

export function ContentTeamScreen() {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<StaffUser | null>(null);
  const [resetting, setResetting] = useState<StaffUser | null>(null);
  const { users, loading, error, refresh } = useUsers(CONTENT_TEAM_ROLE_IDS);
  const { roleLabel, loading: rolesLoading } = useRoles();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [u.full_name, u.email, u.phone ?? "", ...u.roles.map(roleLabel)].some((v) => v.toLowerCase().includes(q)),
    );
  }, [users, query, roleLabel]);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Content team</h1>
          <p className="text-sm text-muted-foreground">Create and manage content creator and reviewer accounts.</p>
        </div>
        <AddUserDialog
          onCreated={() => void refresh()}
          allowedRoleIds={CONTENT_TEAM_ROLE_IDS}
          triggerLabel="Add team member"
          title="Add content team member"
          description="Create a content creator or reviewer account. Share the email and temporary password with them; they can change it after signing in."
        />
      </div>

      <div className="relative max-w-sm">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name, email, phone or role"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8"
        />
      </div>

      <div className="border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading || rolesLoading ? (
              <TableSkeletonRows columns={["w-32", "w-48", "w-24", "w-28", "w-16", "w-20 ml-auto"]} />
            ) : error || filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className={`h-24 text-center ${error ? "text-destructive" : "text-muted-foreground"}`}>
                  {error ? `Could not load the content team: ${error}` : "No content team members found."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.full_name}</TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell>{u.phone ?? "—"}</TableCell>
                  <TableCell>{u.roles.map(roleLabel).join(", ")}</TableCell>
                  <TableCell>
                    <Badge variant={u.status === "active" ? "default" : "secondary"}>{u.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <UserStatusButton user={u} onChanged={() => void refresh()} />
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${u.full_name}`} onClick={() => setEditing(u)}>
                        <PencilIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Reset password for ${u.full_name}`}
                        onClick={() => setResetting(u)}
                      >
                        <KeyRoundIcon />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <EditUserDialog
        user={editing}
        onClose={() => setEditing(null)}
        onSaved={() => void refresh()}
        allowedRoleIds={CONTENT_TEAM_ROLE_IDS}
      />
      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
    </div>
  );
}
