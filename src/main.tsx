import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Bootstrap from "./app/Bootstrap";
import "./styles.css";

window.__NBA_MANAGER_HUPU_SDK__ = {
  teamPlayers: (teamId) => window.ColorboxAI!.request!.basketball!.teamPlayerList!({ teamId, leagueType: "nba" }),
  teamSalaryInfo: (teamId) => window.ColorboxAI!.request!.basketball!.teamSalaryInfo!({ teamId, leagueType: "nba" }),
  playerInfo: (playerId) => window.ColorboxAI!.request!.basketball!.playerInfo!({ playerId, leagueType: "nba" }),
};

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Bootstrap />
  </StrictMode>,
);
