import { useState } from "react";
import { resolveDivisionStandings } from "../game/standings/standings";
import type { Division, GameState, StandingRecord, Team } from "../game/state/types";
import { conferenceLabel, divisionLabel } from "./uiText";

export type StandingsView = "WEST" | "EAST" | "DIVISION";

export function winningPercentage(record: StandingRecord): string {
  const games = record.wins + record.losses;
  return (games ? record.wins / games : 0).toFixed(3).replace(/^0/u, "");
}

export function gamesBehind(leader: StandingRecord, record: StandingRecord): string {
  const difference = (leader.wins - record.wins + record.losses - leader.losses) / 2;
  return difference === 0 ? "—" : Number.isInteger(difference) ? String(difference) : difference.toFixed(1);
}

export function streakLabel(streak: number): string {
  return streak > 0 ? `${streak}连胜` : streak < 0 ? `${Math.abs(streak)}连败` : "—";
}

export function standingsTeamName(team: Team): string {
  const name = team.name.startsWith(team.city) ? team.name.slice(team.city.length).trim() : team.name;
  return name && name !== "队" ? name : team.abbreviation;
}

function StandingsLogo({ team }: { team: Team }) {
  const [failed, setFailed] = useState(false);
  const name = standingsTeamName(team);
  return <span className="standings-logo" style={{ background: `linear-gradient(145deg, ${team.primaryColor}, ${team.secondaryColor})` }} aria-label={`${name}队徽`}>
    {team.logoUrl && !failed ? <img src={team.logoUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span aria-hidden="true">{name.slice(0, 2)}</span>}
  </span>;
}

function StandingsTable({ records, teams, userTeamId, onOpenTeam, division = false }: {
  records: StandingRecord[];
  teams: GameState["teams"];
  userTeamId: string;
  onOpenTeam: (teamId: string) => void;
  division?: boolean;
}) {
  const leader = records[0];
  return <div className="standings-table-scroll"><div className={`standings-table ${division ? "division-table" : "conference-table"}`}>
    <div className="prototype-standings-head"><span>#</span><span className="team-heading">球队</span><span>胜-负</span>{division ? <><span>胜差</span><span>联盟胜-负</span><span>分区胜-负</span></> : <><span>胜率</span><span>胜场差</span><span>近况</span></>}</div>
    <ol className="standings-list prototype-standings-list">
      {records.map((record, index) => {
        const team = teams[record.teamId];
        return <li key={record.teamId} className={record.teamId === userTeamId ? "mine" : ""}><button type="button" onClick={() => onOpenTeam(team.id)} aria-label={`查看${team.fullName}阵容`}>
          <span className="rank">{index + 1}</span>
          <StandingsLogo team={team} />
          <span className="standing-team"><b>{standingsTeamName(team)}</b></span>
          <span className="record">{record.wins}-{record.losses}</span>
          {division ? <>
            <span className="games-behind">{leader ? gamesBehind(leader, record) : "—"}</span>
            <span className="split-record">{record.conferenceWins}-{record.conferenceLosses}</span>
            <span className="split-record">{record.divisionWins}-{record.divisionLosses}</span>
          </> : <>
            <span className="win-percentage">{winningPercentage(record)}</span>
            <span className="games-behind">{leader ? gamesBehind(leader, record) : "—"}</span>
            <span className={`streak ${team.currentStreak > 0 ? "winning" : team.currentStreak < 0 ? "losing" : ""}`}>{streakLabel(team.currentStreak)}</span>
          </>}
        </button></li>;
      })}
    </ol>
  </div></div>;
}

export function StandingsPanel({ state, view, conferenceStandings, onOpenTeam }: {
  state: GameState;
  view: StandingsView;
  conferenceStandings: Record<"WEST" | "EAST", StandingRecord[]>;
  onOpenTeam: (teamId: string) => void;
}) {
  if (view !== "DIVISION") {
    return <StandingsTable records={conferenceStandings[view]} teams={state.teams} userTeamId={state.userTeamId} onOpenTeam={onOpenTeam} />;
  }
  const divisions = [...new Set(Object.values(state.teams).map((team) => team.division))] as Division[];
  return <div className="division-standings">
    {divisions.map((division) => {
      const records = resolveDivisionStandings(division, state.standings, state.teams, state.seeds.seasonSeed);
      const conference = state.teams[records[0].teamId].conference;
      return <section key={division} className="division-standings-group" aria-label={divisionLabel(division)}>
        <h3><span>{divisionLabel(division)}</span><small>{conferenceLabel(conference)}</small></h3>
        <StandingsTable records={records} teams={state.teams} userTeamId={state.userTeamId} onOpenTeam={onOpenTeam} division />
      </section>;
    })}
  </div>;
}
