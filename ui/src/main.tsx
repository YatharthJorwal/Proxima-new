import "@fontsource/rajdhani/latin-500.css";
import "@fontsource/rajdhani/latin-600.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { connectBridge } from "./bridge/store";
import "./vision/gazeStore"; // registers the eye-tracking pinch gate before anything uses the pinch trigger
import "./styles.css";

// Subscribe before the first render: "ready" and "log-history" are sent once,
// and an IPC message with no listener attached is dropped.
connectBridge();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
