import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getCapSheet } from "../game/cap/CapSheetService";
import { createCareer, standingsForConference } from "../game/season/career";
import { calculateTeamFit } from "../game/team/TeamFitService";
import { calculateTeamOverall } from "../game/team/TeamRatingService";
import { ManagementContracts, ManagementDraftPicks, ManagementOverview, playerPerGame } from "./ManagementPages";

describe("regular-season management pages", () => {
  it("shows team information and each player's season data, with dashes before games are played", () => {
    const state = createCareer("management-overview");
    const team = state.teams[state.userTeamId];
    const players = team.playerIds.map((id) => state.players[id]);
    const markup = renderToStaticMarkup(createElement(ManagementOverview, {
      team, players, record: state.standings[team.id], seasonId: state.league.seasonId,
      rank: standingsForConference(state, team.conference).findIndex((entry) => entry.teamId === team.id) + 1,
      overall: calculateTeamOverall(state, team.id).overall,
      fit: calculateTeamFit(state, team.id), onOpenPlayer: () => {},
    }));
    expect(markup).toContain("球员赛季概览");
    expect(markup.match(/data-player-id="/g)).toHaveLength(players.length);
    expect(markup).toContain("场均得分");
    expect(markup).toContain("抢断");
    expect(markup).toContain("三分");
    expect(markup).toContain("PG");
    expect(markup).not.toMatch(/TEAM PROFILE|PLAYER STATS|>OVR</u);
    expect(playerPerGame(90, 0)).toBe("—");
    expect(playerPerGame(90, 3)).toBe("30.0");
  });

  it("shows cap breakdown and player contract terms without offering unsupported editing", () => {
    const state = createCareer("management-contracts");
    const players = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]);
    const markup = renderToStaticMarkup(createElement(ManagementContracts, {
      players, sheet: getCapSheet(state, state.userTeamId), onOpenPlayer: () => {},
    }));
    for (const label of ["薪资进度", "帽下空间", "球员合同", "死钱", "薪资占位", "报价预留", "未满员费用"]) expect(markup).toContain(label);
    expect(markup).toContain('class="draft-cap-meter-track"');
    expect(markup).toContain('class="draft-cap-meter-fill"');
    for (const threshold of ["cap", "tax", "first", "second"]) expect(markup).toContain(`class="threshold-${threshold}"`);
    expect(markup.match(/class="manage-contract-player"/g)).toHaveLength(players.length);
    expect(markup).not.toContain("提交报价");
    expect(markup).not.toMatch(/PAYROLL|CAP BREAKDOWN|CONTRACTS/u);
  });

  it("offers a separate waive action for each contract when the season permits it", () => {
    const state = createCareer("management-waive");
    const players = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]);
    const markup = renderToStaticMarkup(createElement(ManagementContracts, {
      players, sheet: getCapSheet(state, state.userTeamId), onOpenPlayer: () => {}, onWaive: async () => {},
    }));
    expect(markup.match(/class="manage-contract-waive"/g)).toHaveLength(players.length);
    expect(markup.match(/class="manage-contract-detail"/g)).toHaveLength(players.length);
    expect(markup).toContain("裁员");
  });

  it("groups only owned picks by year and marks existing commitments", () => {
    const state = createCareer("management-picks");
    const ownId = state.userTeamId;
    const otherId = Object.keys(state.teams).find((id) => id !== ownId)!;
    const markup = renderToStaticMarkup(createElement(ManagementDraftPicks, {
      userTeamId: ownId, teams: state.teams,
      picks: [
        { id: "own-first", year: 2028, round: 1, originalTeamId: ownId, ownerTeamId: ownId },
        { id: "incoming-second", year: 2029, round: 2, originalTeamId: otherId, ownerTeamId: ownId, reservedByCommitmentId: "promise" },
        { id: "not-owned", year: 2027, round: 1, originalTeamId: otherId, ownerTeamId: otherId },
      ],
    }));
    expect(markup).toContain("2028 年");
    expect(markup).toContain("2029 年");
    expect(markup).not.toContain("2027 年");
    expect(markup).toContain("已承诺");
    expect(markup).not.toContain("保护顺位");
    expect(markup.match(/class="manage-pick-round/g)).toHaveLength(2);
    expect(markup).toContain("首轮");
    expect(markup).toContain("次轮");
    expect(markup).not.toMatch(/DRAFT ASSETS|DRAFT 2028|>R[12]</u);
  });
});
