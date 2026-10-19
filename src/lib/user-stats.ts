import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Sign-up statistics for the superadmin's Overview. `superadmin_user_stats` returns accounts grouped by where they came
// from, how they signed up, the day they signed up and the day they were last seen (India days); everything shown is
// added up here. "Last seen" is recent activity only: there's no record of every day someone used an app.

/** 'signed_up': made their own account in PrepCode. 'added': created from prepwisely (staff, students, faculty, TPO). */
export type AccountSource = "signed_up" | "added";

export interface UserStatsRow {
  source: AccountSource;
  method: string;
  created_day: string;
  /** Null if they never signed in. */
  seen_day: string | null;
  users: number;
}

export function useUserStats() {
  return useQuery({
    queryKey: ["user-stats"],
    queryFn: async (): Promise<UserStatsRow[]> => {
      const { data, error } = await supabase.rpc("superadmin_user_stats");
      if (error) throw new Error(error.message);
      return data as UserStatsRow[];
    },
  });
}

export const METHOD_LABELS: Record<string, string> = {
  google: "Google",
  github: "GitHub",
  email: "Email & password",
};

/** Today in India, as YYYY-MM-DD (the same days the database counts in). */
export function indiaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

/** The YYYY-MM-DD day `days` before `day`. */
export function daysBefore(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export interface UserStats {
  total: number;
  newToday: number;
  newWeek: number;
  newMonth: number;
  activeToday: number;
  activeWeek: number;
  activeMonth: number;
  /** Seen again on a later day than they signed up. */
  returning: number;
  /** Signed in, but not seen after the day they signed up (counting only those who signed up before today). */
  notReturned: number;
  /** Accounts made before today: the ones that could have come back. */
  couldReturn: number;
  neverSignedIn: number;
  /** Method -> accounts, largest first. */
  methods: { method: string; users: number }[];
  /** Sign-ups on each of the last `days` days, oldest first. */
  daily: { day: string; users: number }[];
}

export function summarize(rows: UserStatsRow[], today: string, days = 30): UserStats {
  const weekStart = daysBefore(today, 6);
  const monthStart = daysBefore(today, 29);
  const stats: UserStats = {
    total: 0,
    newToday: 0,
    newWeek: 0,
    newMonth: 0,
    activeToday: 0,
    activeWeek: 0,
    activeMonth: 0,
    returning: 0,
    notReturned: 0,
    couldReturn: 0,
    neverSignedIn: 0,
    methods: [],
    daily: [],
  };
  const methods = new Map<string, number>();
  const daily = new Map<string, number>();
  for (const r of rows) {
    const n = r.users;
    stats.total += n;
    if (r.created_day === today) stats.newToday += n;
    if (r.created_day >= weekStart) stats.newWeek += n;
    if (r.created_day >= monthStart) stats.newMonth += n;
    if (r.seen_day === today) stats.activeToday += n;
    if (r.seen_day && r.seen_day >= weekStart) stats.activeWeek += n;
    if (r.seen_day && r.seen_day >= monthStart) stats.activeMonth += n;
    if (r.seen_day === null) stats.neverSignedIn += n;
    if (r.created_day < today) {
      stats.couldReturn += n;
      if (r.seen_day && r.seen_day > r.created_day) stats.returning += n;
      else if (r.seen_day) stats.notReturned += n;
    }
    methods.set(r.method, (methods.get(r.method) ?? 0) + n);
    daily.set(r.created_day, (daily.get(r.created_day) ?? 0) + n);
  }
  stats.methods = [...methods].map(([method, users]) => ({ method, users })).sort((a, b) => b.users - a.users);
  for (let i = days - 1; i >= 0; i--) {
    const day = daysBefore(today, i);
    stats.daily.push({ day, users: daily.get(day) ?? 0 });
  }
  return stats;
}
