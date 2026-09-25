import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

// Drill-down pages (e.g. Depts & batches › SEC › CSE) add crumbs after the page title in the header. The screen
// owns the drill-down state, so it also says what clicking the page title (`onRoot`) or a crumb does.

export interface Crumb {
  label: string;
  /** Omit for the current (last) crumb. */
  onClick?: () => void;
}

export interface Trail {
  items: Crumb[];
  onRoot: () => void;
}

const TrailContext = createContext<{ trail: Trail | null; setTrail: (trail: Trail | null) => void } | null>(null);

export function BreadcrumbTrailProvider({ children }: { children: ReactNode }) {
  const [trail, setTrail] = useState<Trail | null>(null);
  return <TrailContext.Provider value={{ trail, setTrail }}>{children}</TrailContext.Provider>;
}

/** The current trail, for the header. */
export function useBreadcrumbTrail() {
  return useContext(TrailContext)?.trail ?? null;
}

/**
 * Show `trail` after the page title while the calling screen is mounted; pass null at the screen's top level.
 * `key` should change whenever the trail's labels do (the callbacks are read from the latest render).
 */
export function useSetBreadcrumbTrail(trail: Trail | null, key: string) {
  const setTrail = useContext(TrailContext)?.setTrail;
  useEffect(() => {
    setTrail?.(trail);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands in for the trail's contents.
  }, [setTrail, key]);
  useEffect(() => () => setTrail?.(null), [setTrail]);
}
