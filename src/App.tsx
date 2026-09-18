import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getVersion } from "@tauri-apps/api/app";
import reactLogo from "./assets/react.svg";
import { invoke } from "@tauri-apps/api/core";
import { checkForUpdates } from "./updater";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toaster } from "@/components/ui/sonner";
import "./App.css";

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    const toastId = toast.loading("Checking for updates...");

    checkForUpdates(async (status) => {
      switch (status.state) {
        case "idle": {
          const version = await getVersion();
          toast.success(`You're up to date (v${version})`, { id: toastId });
          break;
        }
        case "downloading": {
          const pct = status.contentLength
            ? Math.round((status.downloaded / status.contentLength) * 100)
            : null;
          toast.loading(pct !== null ? `Downloading update... ${pct}%` : "Downloading update...", {
            id: toastId,
          });
          break;
        }
        case "installing":
          toast.loading("Installing update...", { id: toastId });
          break;
        case "relaunching":
          toast.loading("Restarting app...", { id: toastId });
          break;
      }
    }).catch((err) => {
      console.error(err);
      toast.error("Update check failed", { id: toastId });
    });
  }, []);

  async function greet() {
    // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
    setGreetMsg(await invoke("greet", { name }));
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <Toaster />
      <h1 className="text-3xl font-bold">Welcome to Tauri + React (v0.1.4 - auto-update test)</h1>

      <div className="flex items-center justify-center gap-6">
        <a href="https://vite.dev" target="_blank">
          <img src="/vite.svg" className="h-24 w-24 transition-transform hover:scale-110" alt="Vite logo" />
        </a>
        <a href="https://tauri.app" target="_blank">
          <img src="/tauri.svg" className="h-24 w-24 transition-transform hover:scale-110" alt="Tauri logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="h-24 w-24 transition-transform hover:scale-110" alt="React logo" />
        </a>
      </div>
      <p className="text-muted-foreground">Click on the Tauri, Vite, and React logos to learn more.</p>

      <form
        className="flex items-center justify-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          greet();
        }}
      >
        <Input
          id="greet-input"
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Enter a name..."
        />
        <Button type="submit">Greet</Button>
      </form>
      <p>{greetMsg}</p>
    </main>
  );
}

export default App;
