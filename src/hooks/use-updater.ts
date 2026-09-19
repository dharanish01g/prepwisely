import { useCallback, useEffect, useState } from "react";
import { checkNow, installAndRelaunch, startBackgroundUpdates, type UpdateState } from "@/updater";

export function useUpdater() {
  const [state, setState] = useState<UpdateState>({ status: "idle" });

  useEffect(() => startBackgroundUpdates(setState), []);

  const check = useCallback(() => checkNow(setState), []);
  const install = useCallback(() => installAndRelaunch(setState), []);
  const dismiss = useCallback(() => setState({ status: "idle" }), []);

  return { state, check, install, dismiss };
}
