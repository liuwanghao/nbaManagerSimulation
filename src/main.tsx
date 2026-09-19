import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Bootstrap from "./app/Bootstrap";
import "./styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Bootstrap />
  </StrictMode>,
);
