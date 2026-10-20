import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { bootMotion } from "./motion";
import "./styles/index.css";

// One clock and the scroll feed exist before the first page mounts.
bootMotion();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
