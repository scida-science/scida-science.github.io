import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { PortalProvider } from "./state/PortalContext";
import App from "./App";
import "katex/dist/katex.min.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PortalProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </PortalProvider>
  </React.StrictMode>,
);
