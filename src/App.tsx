import { useEffect, useState } from "react";
import reactLogo from "./assets/react.svg";
import { invoke } from "@tauri-apps/api/core";
import { checkForUpdates, type UpdateStatus } from "./updater";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import "./App.css";

function UpdateOverlay({ status }: { status: UpdateStatus }) {
  let message = "";
  switch (status.state) {
    case "checking":
      message = "Checking for updates...";
      break;
    case "downloading": {
      const pct = status.contentLength
        ? Math.round((status.downloaded / status.contentLength) * 100)
        : null;
      message = pct !== null ? `Downloading update... ${pct}%` : "Downloading update...";
      break;
    }
    case "installing":
      message = "Installing update...";
      break;
    case "relaunching":
      message = "Restarting app...";
      break;
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 text-lg text-white">
      <p>{message}</p>
    </div>
  );
}

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: "idle" });

  useEffect(() => {
    checkForUpdates(setUpdateStatus).catch((err) => {
      console.error(err);
      setUpdateStatus({ state: "idle" });
    });
  }, []);

  const isBlocking = updateStatus.state !== "idle" && updateStatus.state !== "error";

  async function greet() {
    // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
    setGreetMsg(await invoke("greet", { name }));
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      {isBlocking && <UpdateOverlay status={updateStatus} />}
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
