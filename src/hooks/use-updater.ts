import { useCallback, useEffect, useState } from "react";
import { checkNow, deferUpdate, installAndRelaunch, startBackgroundUpdates, type UpdateState } from "@/updater";

export function useUpdater() {
  const [state, setState] = useState<UpdateState>({ status: "idle" });

  useEffect(() => startBackgroundUpdates(setState), []);

  const check = useCallback(() => checkNow(setState), []);
  const install = useCallback(() => installAndRelaunch(setState), []);
  const dismiss = useCallback(() => setState({ status: "idle" }), []);
  const later = useCallback(() => {
    deferUpdate();
    setState({ status: "idle" });
  }, []);

  return { state, check, install, dismiss, later };
}
