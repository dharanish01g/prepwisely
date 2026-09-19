import { useEffect, useState } from "react";
import reactLogo from "./assets/react.svg";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UpdateBanner } from "@/components/update-banner";
import { useUpdater } from "@/hooks/use-updater";
import "./App.css";

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");
  const [version, setVersion] = useState<string | null>(null);
  const updater = useUpdater();

  useEffect(() => {
    getVersion().then(setVersion).catch(console.error);
  }, []);

  async function greet() {
    // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
    setGreetMsg(await invoke("greet", { name }));
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <UpdateBanner state={updater.state} onInstall={updater.install} onDismiss={updater.dismiss} />
      <Button variant="outline" size="sm" className="absolute top-4 right-4" onClick={updater.check}>
        Check for updates
      </Button>
      <h1 className="text-3xl font-bold">Welcome to Tauri + React{version && ` (v${version})`}</h1>

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
