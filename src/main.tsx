import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";

import App from "./App";
import "./styles/global.css";

// Marks the document so the stylesheet can drop the opaque background and let the
// Windows 11 Mica backdrop show through. In a plain browser there is nothing behind
// the page, so the flag stays off and the solid fill is kept.
if (isTauri()) {
  document.documentElement.dataset.tauri = "true";
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
