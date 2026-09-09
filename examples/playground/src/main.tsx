import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { GeometryDemo } from "./geometryDemo";
import "./playground.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {new URLSearchParams(location.search).has("geometry") ? <GeometryDemo /> : <App />}
  </StrictMode>,
);
