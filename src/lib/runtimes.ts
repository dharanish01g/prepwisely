import { useQuery } from "@tanstack/react-query";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Language } from "@/lib/practice-questions";

// Which languages this computer can run (the Rust `runtime_status` command). prepwisely installs nothing: authors
// install a language themselves to check solutions in it.

export interface RuntimeStatus {
  id: Language;
  installed: boolean;
  version: string | null;
}

export const INSTALL_HINT: Record<Language, string> = {
  python: "Install Python 3 from python.org.",
  java: "Install a JDK (for example Temurin from adoptium.net). A JRE alone can't compile Java.",
  cpp: "Install a C++ compiler: on a Mac run xcode-select --install; on Windows install MSYS2 (g++).",
  c: "Install a C compiler: on a Mac run xcode-select --install; on Windows install MSYS2 (gcc).",
  csharp: "Install the .NET SDK from dot.net.",
};

/** Null outside the desktop app (e.g. in a browser), where nothing can run. */
export function useRuntimes() {
  return useQuery({
    queryKey: ["runtimes"],
    queryFn: async (): Promise<RuntimeStatus[] | null> => (isTauri() ? await invoke<RuntimeStatus[]>("runtime_status") : null),
    staleTime: Infinity,
  });
}
