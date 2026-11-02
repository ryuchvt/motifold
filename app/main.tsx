import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Studio } from "./Studio";
import { recording, rememberOwnKey } from "./spark";
import "./app.css";
import "./studio.css";

rememberOwnKey();
// For building a prepared demo out of a real run.
if (location.search.includes("record")) (window as unknown as { __recording: unknown }).__recording = recording;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Studio />
  </StrictMode>,
);
