import { useEffect, useState } from "react";
import reactLogo from "./assets/react.svg";
import { invoke } from "@tauri-apps/api/core";
import { checkForUpdates, type UpdateStatus } from "./updater";
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
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.85)",
        color: "white",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        fontSize: "1.2rem",
      }}
    >
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
    <main className="container">
      {isBlocking && <UpdateOverlay status={updateStatus} />}
      <h1>Welcome to Tauri + React (v0.1.4 - auto-update test)</h1>

      <div className="row">
        <a href="https://vite.dev" target="_blank">
          <img src="/vite.svg" className="logo vite" alt="Vite logo" />
        </a>
        <a href="https://tauri.app" target="_blank">
          <img src="/tauri.svg" className="logo tauri" alt="Tauri logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <p>Click on the Tauri, Vite, and React logos to learn more.</p>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          greet();
        }}
      >
        <input
          id="greet-input"
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Enter a name..."
        />
        <button type="submit">Greet</button>
      </form>
      <p>{greetMsg}</p>
    </main>
  );
}

export default App;
