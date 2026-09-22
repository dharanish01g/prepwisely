import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { type College, useSetCollegeStatus } from "@/lib/colleges";

/** Suspend/reactivate in one toggle. Superadmin-only — see superadmin_set_college_status(). */
export function CollegeStatusButton({ college }: { college: College }) {
  const setStatus = useSetCollegeStatus();
  const active = college.status === "active";

  function handleChange(next: boolean) {
    setStatus.mutate(
      { id: college.id, status: next ? "active" : "suspended" },
      { onSuccess: () => toast.success(`${next ? "Reactivated" : "Suspended"} ${college.name}.`) },
    );
  }

  return (
    <Switch
      checked={active}
      onCheckedChange={handleChange}
      disabled={setStatus.isPending}
      aria-label={`${active ? "Suspend" : "Reactivate"} ${college.name}`}
    />
  );
}
