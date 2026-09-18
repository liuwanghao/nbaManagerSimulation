import type { Position } from "../game/state/types";

export interface Real2026DraftEntry {
  realPickNumber: number;
  playerId: string;
  fullName: string;
  draftingTeamId: string;
  finalTeamId: string;
  position?: Position;
  heightCm?: number;
  weightKg?: number;
  age?: number;
}

const pick = (
  realPickNumber: number,
  playerId: string,
  fullName: string,
  draftingTeamId: string,
  finalTeamId: string = draftingTeamId,
  bio: Partial<Pick<Real2026DraftEntry, "position" | "heightCm" | "weightKg" | "age">> = {},
): Real2026DraftEntry => ({ realPickNumber, playerId, fullName, draftingTeamId, finalTeamId, ...bio });

/**
 * 2026 NBA Draft results. `draftingTeamId` is the team attached to the
 * original pick; `finalTeamId` includes the draft-night trades reported by NBA.com.
 */
export const REAL_2026_DRAFT: readonly Real2026DraftEntry[] = [
  pick(1, "nba:1643407", "AJ Dybantsa", "WAS"),
  pick(2, "nba:1643408", "Darryn Peterson", "UTA"),
  pick(3, "nba:1643409", "Cameron Boozer", "MEM"),
  pick(4, "nba:1643410", "Caleb Wilson", "CHI"),
  pick(5, "nba:1643413", "Keaton Wagler", "LAC"),
  pick(6, "nba:1643414", "Mikel Brown Jr.", "BKN"),
  pick(7, "nba:1643411", "Darius Acuff Jr.", "SAC"),
  pick(8, "nba:1643412", "Kingston Flemings", "ATL"),
  pick(9, "draft2026:morez-johnson-jr", "Morez Johnson Jr.", "DAL", "DAL", { position: "PF", heightCm: 206, weightKg: 113, age: 20 }),
  pick(10, "nba:1643415", "Brayden Burries", "MIL"),
  pick(11, "nba:1642865", "Yaxel Lendeborg", "GSW"),
  pick(12, "nba:1643530", "Aday Mara", "OKC"),
  pick(13, "nba:1643417", "Nate Ament", "MIA", "MIL"),
  pick(14, "nba:1643419", "Hannes Steinbach", "CHA"),
  pick(15, "nba:1643517", "Dailyn Swain", "CHI"),
  pick(16, "nba:1642892", "Bennett Stirtz", "MEM", "OKC"),
  pick(17, "nba:1643536", "Ebuka Okorie", "OKC", "DET"),
  pick(18, "nba:1643515", "Christian Anderson", "CHA"),
  pick(19, "nba:1643512", "Allen Graves", "TOR"),
  pick(20, "nba:1643519", "Jayden Quaintance", "SAS"),
  pick(21, "nba:1643510", "Karim Lopez", "DET", "MEM"),
  pick(22, "draft2026:labaron-philon-jr", "Labaron Philon Jr.", "PHI", "PHI", { position: "PG", heightCm: 193, weightKg: 80, age: 20 }),
  pick(23, "nba:1643544", "Zuby Ejiofor", "ATL"),
  pick(24, "nba:1643418", "Cameron Carr", "NYK", "LAL"),
  pick(25, "nba:1643547", "Sergio de Larrea", "LAL", "DAL"),
  pick(26, "nba:1643542", "Tarris Reed Jr.", "DEN", "SAS"),
  pick(27, "nba:1643416", "Chris Cenac Jr.", "BOS"),
  pick(28, "nba:1643538", "Joshua Jefferson", "MIN", "BKN"),
  pick(29, "nba:1642284", "Alex Karaban", "CLE", "SAC"),
  pick(30, "nba:1643520", "Koa Peat", "DAL", "PHX"),
  pick(31, "nba:1643570", "Bruce Thornton", "NYK", "HOU"),
  pick(32, "draft2026:richie-saunders", "Richie Saunders", "MEM", "MEM", { position: "SG", heightCm: 196, weightKg: 91, age: 23 }),
  pick(33, "nba:1642912", "Isaiah Evans", "BKN", "MIN"),
  pick(34, "nba:1643509", "Meleek Thomas", "SAC", "CLE"),
  pick(35, "nba:1642350", "Trevon Brazile", "SAS", "DEN"),
  pick(36, "nba:1642394", "Baba Miller", "LAC"),
  pick(37, "nba:1643553", "Ryan Conwell", "OKC", "MIA"),
  pick(38, "nba:1643552", "Braden Smith", "CHI", "IND"),
  pick(39, "draft2026:jack-kayil", "Jack Kayil", "HOU", "NYK", { position: "PG", heightCm: 191, weightKg: 79, age: 20 }),
  pick(40, "nba:1641759", "Dillon Mitchell", "BOS"),
  pick(41, "draft2026:otega-oweh", "Otega Oweh", "MIA", "OKC", { position: "SG", heightCm: 193, weightKg: 98, age: 23 }),
  pick(42, "draft2026:jakobi-gillespie", "Ja'Kobi Gillespie", "SAS", "SAS", { position: "PG", heightCm: 185, weightKg: 84, age: 22 }),
  pick(43, "nba:1643548", "Tyler Bilodeau", "BKN"),
  pick(44, "draft2026:maliq-brown", "Maliq Brown", "SAS", "SAS", { position: "PF", heightCm: 206, weightKg: 102, age: 22 }),
  pick(45, "nba:1643567", "Emanuel Sharp", "SAC"),
  pick(46, "draft2026:felix-okpara", "Felix Okpara", "ORL", "WAS", { position: "C", heightCm: 211, weightKg: 107, age: 23 }),
  pick(47, "draft2026:tyler-nickel", "Tyler Nickel", "PHX", "NYK", { position: "SF", heightCm: 201, weightKg: 100, age: 22 }),
  pick(48, "nba:1643588", "Tobi Lawal", "DAL"),
  pick(49, "nba:1643624", "Bryce Hopkins", "DEN"),
  pick(50, "nba:1643558", "Jaden Bradley", "TOR"),
  pick(51, "nba:1643593", "Izaiyah Nelson", "WAS", "ORL"),
  pick(52, "nba:1643539", "Henri Veesaar", "LAC", "ATL"),
  pick(53, "nba:1642391", "Ugonna Onyenso", "HOU", "DET"),
  pick(54, "draft2026:lajae-jones", "Lajae Jones", "GSW", "GSW", { position: "SF", heightCm: 201, weightKg: 100, age: 22 }),
  pick(55, "nba:1643568", "Nick Martinelli", "NYK", "LAC"),
  pick(56, "draft2026:vsevolod-ishchenko", "Vsevolod Ishchenko", "CHI", "DAL", { position: "PG", heightCm: 191, weightKg: 84, age: 21 }),
  pick(57, "draft2026:narcisse-ngoy", "Narcisse Ngoy", "ATL", "LAC", { position: "C", heightCm: 213, weightKg: 109, age: 21 }),
  pick(58, "draft2026:jaron-pierre-jr", "Jaron Pierre Jr.", "NOP", "NOP", { position: "SG", heightCm: 196, weightKg: 95, age: 23 }),
  pick(59, "draft2026:trey-kaufman-renn", "Trey Kaufman-Renn", "MIN", "MIN", { position: "PF", heightCm: 206, weightKg: 109, age: 24 }),
  pick(60, "draft2026:malique-lewis", "Malique Lewis", "WAS", "MIL", { position: "SF", heightCm: 203, weightKg: 88, age: 21 }),
];

/** Real players carried in the 2026 class as undrafted candidates. */
export const REAL_2026_UNDRAFTED_PLAYER_IDS: readonly string[] = [
  "nba:1642850", "nba:1642881", "nba:1643640", "nba:1643637", "nba:1643573",
  "nba:1642369", "nba:1643595", "nba:1643572", "nba:1643591", "nba:1643621",
];

export const REAL_2026_DRAFT_PLAYER_IDS = new Set(REAL_2026_DRAFT.map((entry) => entry.playerId));
export const REAL_2026_CLASS_ROSTER_EXCLUSIONS = new Set([
  ...REAL_2026_DRAFT_PLAYER_IDS,
  ...REAL_2026_UNDRAFTED_PLAYER_IDS,
]);
