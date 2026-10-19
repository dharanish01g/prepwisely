import { FunctionsHttpError } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Platform analytics for the superadmin. Traffic comes from hourly summaries of the API gateway's logs, saved every
// hour by the `platform-snapshot` Edge Function (the Free plan keeps logs for about a day, so history starts when the
// snapshots did). Storage comes live from the database. Bandwidth is an estimate: many responses don't report a size.

/** The Free plan's limits, to show usage against. */
export const FREE_PLAN = {
  databaseBytes: 500 * 1024 ** 2,
  storageBytes: 1024 ** 3,
  egressBytes: 5 * 1024 ** 3,
};

export const SERVICE_LABELS: Record<string, string> = {
  database: "Database API",
  auth: "Sign-in",
  storage: "File storage",
  functions: "Functions",
  realtime: "Realtime",
  other: "Other",
};

export interface HourlyRow {
  hour: string;
  service: string;
  requests: number;
  errors_4xx: number;
  errors_5xx: number;
  total_ms: number;
  max_ms: number;
  bytes: number;
  updated_at: string;
}

export interface HourlyErrorRow {
  hour: string;
  method: string;
  path: string;
  status: number;
  requests: number;
}

export interface StorageStats {
  database_bytes: number;
  buckets: { bucket: string; files: number; bytes: number }[];
  tables: { table: string; bytes: number; rows: number }[];
}

const toError = (error: { message: string }) => new Error(error.message);

/** Hourly traffic over the last `days` days, oldest first. */
export function usePlatformHourly(days: number) {
  return useQuery({
    queryKey: ["platform-hourly", days],
    queryFn: async () => {
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const [hourly, errors] = await Promise.all([
        supabase.from("platform_hourly").select("*").gte("hour", since).order("hour"),
        supabase.from("platform_hourly_errors").select("*").gte("hour", since),
      ]);
      if (hourly.error) throw toError(hourly.error);
      if (errors.error) throw toError(errors.error);
      return { hourly: hourly.data as HourlyRow[], errors: errors.data as HourlyErrorRow[] };
    },
  });
}

export function useStorageStats() {
  return useQuery({
    queryKey: ["storage-stats"],
    queryFn: async (): Promise<StorageStats> => {
      const { data, error } = await supabase.rpc("superadmin_storage_stats");
      if (error) throw toError(error);
      return data as StorageStats;
    },
  });
}

/** Saves the last 24 hours now, instead of waiting for the hourly run. */
export function useUpdatePlatformNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke("platform-snapshot", { body: {} });
      if (error) {
        if (error instanceof FunctionsHttpError) {
          const payload = await error.context.json().catch(() => null);
          throw new Error(payload?.error ?? "Couldn't update the traffic");
        }
        throw new Error(error.message);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["platform-hourly"] }),
  });
}

export function formatBytes(bytes: number) {
  const units = ["B", "kB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** The hour of day (0-23) and weekday (0 = Monday) of a UTC hour, in India time. */
export function indiaHour(hour: string): { day: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(hour));
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  return {
    day: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday),
    hour: Number(parts.find((p) => p.type === "hour")?.value ?? 0),
  };
}
