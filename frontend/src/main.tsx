import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles/themes.css";

const siteTitle = String(
  import.meta.env.VITE_SITE_TITLE ?? "配对检测系统",
).trim() || "配对检测系统";
document.title = siteTitle;

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
