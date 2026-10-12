// Bundle Monaco with the app instead of letting @monaco-editor/react fetch it from a CDN, so the editor works offline
// (the same setup as PrepCode). Only syntax highlighting is used, so the base editor worker is the only one needed.
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";

self.MonacoEnvironment = {
  getWorker() {
    return new EditorWorker();
  },
};

loader.config({ monaco });
