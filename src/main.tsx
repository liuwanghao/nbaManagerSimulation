import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Bootstrap from "./app/Bootstrap";
import { GameErrorBoundary } from "./app/GameErrorBoundary";
import "./styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <GameErrorBoundary>
      <Bootstrap />
    </GameErrorBoundary>
  </StrictMode>,
);
