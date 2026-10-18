import { error as logError, info as logInfo, warn as logWarn } from "@tauri-apps/plugin-log";

// Sentry's browser SDK, put on every page by tauri-plugin-sentry (see
// reporting.rs). It reports uncaught errors by itself.
declare global {
  interface Window {
    Sentry?: {
      captureException(
        error: unknown,
        hint?: { contexts?: Record<string, Record<string, unknown>> },
      ): string;
      addBreadcrumb(breadcrumb: {
        category: string;
        message: string;
        level: "info" | "warning";
      }): void;
    };
  }
}

function describe(value: unknown) {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// Never logs a failure to the console: that would come straight back here.
function writeLog(write: typeof logError, message: string) {
  write(message).catch(() => {});
}

/**
 * Copies console errors and warnings, and uncaught errors, into prepwisely's
 * log file, so they can be read on a staff member's computer. Call once, first.
 */
export function startLogging() {
  for (const [level, write] of [
    ["error", logError],
    ["warn", logWarn],
  ] as const) {
    const original = console[level];
    console[level] = (...args: unknown[]) => {
      original(...args);
      writeLog(write, args.map(describe).join(" "));
    };
  }
  window.addEventListener("error", (event) =>
    writeLog(logError, `Uncaught: ${describe(event.error ?? event.message)}`),
  );
  window.addEventListener("unhandledrejection", (event) =>
    writeLog(logError, `Unhandled rejection: ${describe(event.reason)}`),
  );

  // When the internet goes and comes back, so a report shows what else
  // happened while it was off.
  const network = (online: boolean) => {
    const message = online ? "Back online" : "Went offline";
    writeLog(online ? logInfo : logWarn, message);
    window.Sentry?.addBreadcrumb({
      category: "network",
      message,
      level: online ? "info" : "warning",
    });
  };
  if (!navigator.onLine) network(false);
  window.addEventListener("online", () => network(true));
  window.addEventListener("offline", () => network(false));
}

/** Reports an error that was caught, so Sentry wouldn't see it (e.g. a crashed screen). */
export function reportError(error: unknown, componentStack?: string | null) {
  window.Sentry?.captureException(
    error,
    componentStack ? { contexts: { react: { componentStack } } } : undefined,
  );
  writeLog(logError, `${describe(error)}${componentStack ?? ""}`);
}
