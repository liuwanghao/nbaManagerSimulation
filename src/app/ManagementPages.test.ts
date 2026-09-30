import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getCapSheet } from "../game/cap/CapSheetService";
import { calculatePlayerOverall } from "../game/player/PlayerRatingService";
import { createCareer, standingsForConference } from "../game/season/career";
import { calculateTeamFit } from "../game/team/TeamFitService";
import { calculateTeamOverall } from "../game/team/TeamRatingService";
import { ManagementContracts, ManagementDraftPicks, ManagementOverview, playerPerGame } from "./ManagementPages";
import { PLAYER_RATING_COLORS } from "./playerRatingColor";

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
    expect(markup).not.toContain("阵容发帖交流");
    expect(markup).not.toContain("晒出首发五虎");
    expect(markup).not.toContain("manage-roster-share");
    expect(markup).toContain('aria-label="按主位置筛选球员赛季数据"');
    expect(markup).toContain(`<b>全部</b><small>${players.length}</small>`);
    for (const position of ["PG", "SG", "SF", "PF", "C"]) {
      expect(markup).toContain(`<b>${position}</b><small>${players.filter((player) => player.position === position).length}</small>`);
    }
    expect(markup.match(/data-player-id="/g)).toHaveLength(players.length);
    expect(markup).toContain("场均得分");
    expect(markup).toContain("抢断");
    expect(markup).toContain("三分");
    expect(markup).toContain("PG");
    expect(markup).not.toMatch(/TEAM PROFILE|PLAYER STATS|>OVR</u);
    expect(playerPerGame(90, 0)).toBe("—");
    expect(playerPerGame(90, 3)).toBe("30.0");
  });

  it("keeps fatigue and morale out of the season overview table", () => {
    const state = createCareer("management-player-status");
    const team = state.teams[state.userTeamId];
    const players = team.playerIds.map((id) => state.players[id]);
    players[0].fatigue = 75;
    players[0].morale = 40;
    const markup = renderToStaticMarkup(createElement(ManagementOverview, {
      team, players, record: state.standings[team.id], seasonId: state.league.seasonId,
      rank: 1, overall: calculateTeamOverall(state, team.id).overall,
      fit: calculateTeamFit(state, team.id), onOpenPlayer: () => {},
    }));
    const row = markup.match(new RegExp(`<tr[^>]*data-player-id="${players[0].id}"[^>]*>.*?</tr>`))?.[0];
    expect(markup).not.toContain('<th scope="col">疲劳</th>');
    expect(markup).not.toContain('<th scope="col">士气</th>');
    expect(row).not.toContain("manage-status-cell");
  });

  it("uses the shared OVR color for the displayed roster rating", () => {
    const state = createCareer("management-rating-color");
    const team = state.teams[state.userTeamId];
    const players = team.playerIds.map((id) => state.players[id]);
    players[0].overallAdjustment = (players[0].overallAdjustment ?? 0) + 79.5 - calculatePlayerOverall(players[0]);
    const markup = renderToStaticMarkup(createElement(ManagementOverview, {
      team, players, record: state.standings[team.id], seasonId: state.league.seasonId,
      rank: 1, overall: calculateTeamOverall(state, team.id).overall,
      fit: calculateTeamFit(state, team.id), onOpenPlayer: () => {},
    }));
    const row = markup.match(new RegExp(`<tr[^>]*data-player-id="${players[0].id}"[^>]*>.*?</tr>`))?.[0];
    expect(row).toContain(`<strong class="player-rating-tone" style="--player-rating-color:${PLAYER_RATING_COLORS.excellent}">80</strong>`);
  });

  it("shows cap breakdown and player contract terms without offering unsupported editing", () => {
    const state = createCareer("management-contracts");
    const players = state.teams[state.userTeamId].playerIds.map((id) => state.players[id]);
    const markup = renderToStaticMarkup(createElement(ManagementContracts, {
      players, sheet: getCapSheet(state, state.userTeamId), seasonYear: state.league.seasonYear, onOpenPlayer: () => {},
    }));
    for (const label of ["薪资进度", "帽下空间", "球员合同", "死钱", "薪资占位", "报价预留", "未满员费用", "最低工资差额"]) expect(markup).toContain(label);
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
      players, sheet: getCapSheet(state, state.userTeamId), seasonYear: state.league.seasonYear, onOpenPlayer: () => {}, onWaive: async () => {},
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
