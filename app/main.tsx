import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Studio } from "./Studio";
import { recording, rememberOwnKey } from "./spark";
import "./app.css";
import "./studio.css";
import "./workspace.css";

rememberOwnKey();
// For building a prepared demo out of a real run.
if (location.search.includes("record")) (window as unknown as { __recording: unknown }).__recording = recording;

async function start() {
  const sample = import.meta.env.MODE === "ui" ? await import("./uiPreview") : null;
  const preview = sample ? await sample.loadUiPreview() : null;
  sample?.installUiPreview();
  createRoot(document.getElementById("root")!).render(
    <StrictMode><Studio initialScore={preview} sample={!!sample} initialSetup={sample?.initialSetup} sampleMessage={sample?.previewMessage} /></StrictMode>,
  );
}
void start();
