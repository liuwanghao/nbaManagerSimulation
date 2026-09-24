import { createHash } from "node:crypto";

export const NBA2K_ATTRIBUTE_FIELDS = Object.freeze({
  "Three-Point Shot": "threePointShot",
  "Mid-Range Shot": "midRangeShot",
  "Close Shot": "closeShot",
  "Free Throw": "freeThrow",
  "Offensive Consistency": "offensiveConsistency",
  "Shot IQ": "shotIQ",
  Speed: "speed",
  Strength: "strength",
  Agility: "agility",
  Vertical: "vertical",
  Hustle: "hustle",
  Stamina: "stamina",
  "Overall Durability": "durability",
  Layup: "drivingLayup",
  "Driving Dunk": "drivingDunk",
  "Standing Dunk": "standingDunk",
  "Post Hook": "postHook",
  "Post Fade": "postFade",
  "Post Control": "postControl",
  "Draw Foul": "drawFoul",
  Hands: "hands",
  "Ball Handle": "ballHandle",
  "Speed with Ball": "speedWithBall",
  "Pass Accuracy": "passAccuracy",
  "Pass Vision": "passVision",
  "Pass IQ": "passIQ",
  Block: "block",
  Steal: "steal",
  "Pass Perception": "passPerception",
  "Interior Defense": "interiorDefense",
  "Perimeter Defense": "perimeterDefense",
  "Help Defense IQ": "helpDefenseIQ",
  "Defensive Consistency": "defensiveConsistency",
  "Defensive Rebound": "defensiveRebound",
  "Offensive Rebound": "offensiveRebound",
});

// The NBA CDN uses the official NBA person id, already the stable identity
// key in the offline player dataset. Keep URL construction out of the bundle.
export function nbaOfficialHeadshotUrl(nbaPlayerId, size = "260x190") {
  if (!/^\d+$/u.test(String(nbaPlayerId))) throw new Error(`Invalid NBA player id: ${nbaPlayerId}`);
  if (!/^(?:260x190|1040x760)$/u.test(size)) throw new Error(`Unsupported NBA headshot size: ${size}`);
  return `https://cdn.nba.com/headshots/nba/latest/${size}/${nbaPlayerId}.png`;
}

export function nbaOfficialHeadshotPath(nbaPlayerId) {
  if (!/^\d+$/u.test(String(nbaPlayerId))) throw new Error(`Invalid NBA player id: ${nbaPlayerId}`);
  return `./player-portraits/nba-${nbaPlayerId}.png`;
}

const NAME_ALIASES = new Map(Object.entries({
  alexsarr: "alexandresarr",
  bronnyjames: "bronnyjamesjr",
  bubcarrington: "carltoncarrington",
  jimmybutleriii: "jimmybutler",
  labaronphilon: "labaronphilonjr",
  mobamba: "mohamedbamba",
  nicclaxton: "nicolasclaxton",
  robdillingham: "robertdillingham",
  ronaldhollandii: "ronholland",
  svimykhailiuk: "sviatoslavmykhailiuk",
  xaviertillmansr: "xaviertillman",
}));

const NBA_POSITIONS = Object.freeze(["PG", "SG", "SF", "PF", "C"]);
const NBA_POSITION_SET = new Set(NBA_POSITIONS);

export function validatePositionList(value, context = "player positions") {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
    throw new Error(`${context} must contain one or two positions`);
  }
  if (value.some((position) => !NBA_POSITION_SET.has(position))) {
    throw new Error(`${context} contains an invalid position: ${JSON.stringify(value)}`);
  }
  if (new Set(value).size !== value.length) {
    throw new Error(`${context} contains duplicate positions: ${JSON.stringify(value)}`);
  }
  return [...value];
}

export function validatePositionOverrides(value) {
  if (!value || value.schemaVersion !== 1 || !value.version || value.sourceId !== "curated-player-position-overrides") {
    throw new Error("Player position override metadata is invalid");
  }
  if (!Array.isArray(value.players)) throw new Error("Player position overrides must be an array");
  const ids = new Set();
  const names = new Set();
  for (const player of value.players) {
    if (!/^\d+$/u.test(player.nbaPlayerId ?? "") || ids.has(player.nbaPlayerId)) {
      throw new Error(`Invalid or duplicate position override NBA ID: ${String(player.nbaPlayerId)}`);
    }
    const nameKey = playerNameKey(player.fullName);
    if (!nameKey || names.has(nameKey)) throw new Error(`Invalid or duplicate position override name: ${String(player.fullName)}`);
    validatePositionList(player.positions, `Position override for ${player.fullName}`);
    if (!player.reason?.trim()) throw new Error(`Position override for ${player.fullName} requires a reason`);
    ids.add(player.nbaPlayerId);
    names.add(nameKey);
  }
  return value;
}

export function validatePositionOverrideTargets(overridesInput, identityPlayers) {
  const overrides = validatePositionOverrides(overridesInput);
  const identitiesById = new Map();
  for (const player of identityPlayers) {
    const identities = identitiesById.get(player.nbaPlayerId) ?? [];
    identities.push(player.fullName);
    identitiesById.set(player.nbaPlayerId, identities);
  }
  for (const override of overrides.players) {
    const identities = identitiesById.get(override.nbaPlayerId) ?? [];
    if (!identities.some((name) => playerNameKey(name) === playerNameKey(override.fullName))) {
      throw new Error(`Position override target does not match a known player: ${override.fullName} (${override.nbaPlayerId})`);
    }
  }
  return overrides;
}

export function applyPlayerPositions(datasetInput, roster, ratings, overridesInput) {
  const dataset = structuredClone(datasetInput);
  const overrides = validatePositionOverrides(overridesInput);
  const rosterById = new Map(roster.players.map((player) => [player.nbaPlayerId, player]));
  const overrideByName = new Map(overrides.players.map((player) => [playerNameKey(player.fullName), player]));
  const resolvedRatings = new Map();

  for (const rating of ratings.players) {
    const nameKey = playerNameKey(rating.name);
    const override = overrideByName.get(nameKey);
    const positions = override?.positions ?? validatePositionList(rating.positions, `2K positions for ${rating.name}`);
    resolvedRatings.set(nameKey, { positions, source: override ? "MANUAL_OVERRIDE" : "NBA2K" });
  }

  // Overrides also cover free agents and recently retired players that are not
  // returned by the API's current-team slice.
  for (const override of overrides.players) {
    const rosterPlayer = rosterById.get(override.nbaPlayerId);
    if (rosterPlayer && playerNameKey(rosterPlayer.fullName) !== playerNameKey(override.fullName)) {
      throw new Error(`Position override target does not match the NBA roster: ${override.fullName} (${override.nbaPlayerId})`);
    }
    resolvedRatings.set(playerNameKey(override.fullName), { positions: override.positions, source: "MANUAL_OVERRIDE" });
  }

  let appliedFrom2k = 0;
  let appliedFromOverrides = 0;
  let retainedInferred = 0;
  for (const player of dataset.players) {
    const resolved = resolvedRatings.get(playerNameKey(player.fullName));
    if (!resolved) {
      player.secondaryPosition ??= null;
      player.positionSource ??= "INFERRED";
      retainedInferred += 1;
      continue;
    }
    [player.position, player.secondaryPosition = null] = resolved.positions;
    player.positionSource = resolved.source;
    if (resolved.source === "MANUAL_OVERRIDE") appliedFromOverrides += 1;
    else appliedFrom2k += 1;
  }

  dataset.schemaVersion = 2;
  dataset.positionModelVersion = `nba2k27-primary-secondary-v1+${overrides.version}`;
  return { dataset, appliedFrom2k, appliedFromOverrides, retainedInferred };
}

const TEAM_ABBREVIATIONS = new Map(Object.entries({
  "Atlanta Hawks": "ATL", "Boston Celtics": "BOS", "Brooklyn Nets": "BKN",
  "Charlotte Hornets": "CHA", "Chicago Bulls": "CHI", "Cleveland Cavaliers": "CLE",
  "Dallas Mavericks": "DAL", "Denver Nuggets": "DEN", "Detroit Pistons": "DET",
  "Golden State Warriors": "GSW", "Houston Rockets": "HOU", "Indiana Pacers": "IND",
  "Los Angeles Clippers": "LAC", "Los Angeles Lakers": "LAL", "Memphis Grizzlies": "MEM",
  "Miami Heat": "MIA", "Milwaukee Bucks": "MIL", "Minnesota Timberwolves": "MIN",
  "New Orleans Pelicans": "NOP", "New York Knicks": "NYK", "Oklahoma City Thunder": "OKC",
  "Orlando Magic": "ORL", "Philadelphia 76ers": "PHI", "Phoenix Suns": "PHX",
  "Portland Trail Blazers": "POR", "Sacramento Kings": "SAC", "San Antonio Spurs": "SAS",
  "Toronto Raptors": "TOR", "Utah Jazz": "UTA", "Washington Wizards": "WAS",
}));

const CATEGORY_WEIGHTS = Object.freeze({
  "Outside Scoring": {
    "Three-Point Shot": 0.3, "Mid-Range Shot": 0.25, "Free Throw": 0.1,
    "Close Shot": 0.1, "Offensive Consistency": 0.15, "Shot IQ": 0.1,
  },
  "Inside Scoring": {
    "Close Shot": 0.2, Layup: 0.25, "Driving Dunk": 0.15, "Standing Dunk": 0.1,
    "Post Hook": 0.1, "Post Fade": 0.1, "Post Control": 0.1,
  },
  Playmaking: {
    "Ball Handle": 0.25, "Speed with Ball": 0.15, "Pass Accuracy": 0.25,
    "Pass Vision": 0.15, "Pass IQ": 0.2,
  },
  Athleticism: {
    Speed: 0.2, Strength: 0.15, Agility: 0.2, Vertical: 0.15, Hustle: 0.15, Stamina: 0.15,
  },
  Defense: {
    "Perimeter Defense": 0.2, "Interior Defense": 0.2, Block: 0.12, Steal: 0.12,
    "Pass Perception": 0.1, "Help Defense IQ": 0.13, "Defensive Consistency": 0.13,
  },
  Rebounding: { "Defensive Rebound": 0.65, "Offensive Rebound": 0.35 },
});

const REQUIRED_CATEGORIES = Object.keys(CATEGORY_WEIGHTS);

export const normalizePlayerName = (value) => String(value ?? "").normalize("NFKD")
  .replace(/[\u0300-\u036f]/gu, "")
  .replace(/[^a-z0-9]/giu, "")
  .toLowerCase();

export const playerNameKey = (value) => {
  const normalized = normalizePlayerName(value);
  return NAME_ALIASES.get(normalized) ?? normalized;
};

const clamp = (value, minimum = 25, maximum = 99) => Math.max(minimum, Math.min(maximum, Math.round(value)));

function weighted(attributes, weights) {
  const pairs = Object.entries(weights).filter(([key]) => Number.isFinite(attributes[key]));
  if (pairs.length !== Object.keys(weights).length) return null;
  return clamp(pairs.reduce((total, [key, weight]) => total + attributes[key] * weight, 0));
}

export function deriveCategoryRatings(attributes) {
  return Object.fromEntries(Object.entries(CATEGORY_WEIGHTS).map(([category, weights]) => [
    category,
    weighted(attributes, weights),
  ]));
}

function normalizedAttributes(rawPlayer) {
  const source = rawPlayer.attributes && typeof rawPlayer.attributes === "object"
    ? rawPlayer.attributes
    : rawPlayer;
  return Object.fromEntries(Object.entries(NBA2K_ATTRIBUTE_FIELDS).map(([displayName, apiName]) => [
    displayName,
    Number.isFinite(source[apiName]) ? source[apiName] : null,
  ]));
}

function hasCompleteCategories(value) {
  return REQUIRED_CATEGORIES.every((key) => Number.isFinite(value?.[key]));
}

export function transformApiPlayers(apiPlayers, previousSnapshot = null) {
  const previousByName = new Map((previousSnapshot?.players ?? []).map((player) => [playerNameKey(player.name), player]));
  return apiPlayers
    .filter((player) => player?.teamType === "curr" && Number.isInteger(player.overall))
    .map((player) => {
      const attributes = normalizedAttributes(player);
      const previous = previousByName.get(playerNameKey(player.name));
      const preserveLegacyCategories = previous && hasCompleteCategories(previous.categoryRatings)
        && previous.categoryRatingsSource !== "DERIVED_FROM_ATTRIBUTES";
      const categoryRatings = preserveLegacyCategories
        ? previous.categoryRatings
        : deriveCategoryRatings(attributes);
      return {
        slug: player.slug,
        name: player.name,
        team: player.team,
        teamType: player.teamType,
        positions: player.positions ?? [],
        overall: player.overall,
        archetype: player.archetype ?? player.build ?? null,
        potentialGrade: previous?.potentialGrade ?? null,
        categoryRatings,
        categoryRatingsSource: preserveLegacyCategories ? "LEGACY_EXACT" : "DERIVED_FROM_ATTRIBUTES",
        attributes,
        birthdate: previous?.birthdate ?? null,
        yearsInNba: previous?.yearsInNba ?? null,
        lastUpdated: player.lastUpdated ?? null,
        // Portraits are owned by the NBA Player ID pipeline, not by the 2K
        // provider's image URL. This keeps the ratings snapshot media-free.
        portraitPath: null,
      };
    })
    .sort((left, right) => right.overall - left.overall || left.name.localeCompare(right.name));
}

export function createRatingsSnapshot(apiPayload, previousSnapshot, options = {}) {
  if (!apiPayload?.success || !Array.isArray(apiPayload.data)) throw new Error("NBA2K API returned an unexpected payload");
  const gameVersion = options.gameVersion ?? apiPayload.meta?.gameVersion ?? "2K27";
  const players = transformApiPlayers(apiPayload.data, previousSnapshot);
  const latestUpdate = players.map((player) => player.lastUpdated).filter(Boolean).sort().at(-1)
    ?? apiPayload.meta?.capturedAt
    ?? new Date().toISOString();
  const versionDate = String(latestUpdate).slice(0, 10);
  return {
    schemaVersion: 2,
    game: `NBA ${gameVersion}`,
    snapshotVersion: `nba2kapi-${gameVersion.toLowerCase()}-${versionDate}`,
    capturedAt: options.capturedAt ?? new Date().toISOString(),
    source: {
      provider: "NBA2K API",
      url: `https://api.nba2kapi.com/api/versions/${gameVersion}/players/bulk?teamType=curr`,
      updatedAt: latestUpdate,
      official: false,
      upstreamProvider: "2K Ratings",
      upstreamUrl: "https://www.2kratings.com/",
      note: "Build-time community ratings snapshot. The H5 never calls this API at runtime.",
    },
    attributeNames: Object.keys(NBA2K_ATTRIBUTE_FIELDS),
    players,
  };
}

function mapAttributes(player, mapping) {
  const attributes = player.attributes;
  return {
    shooting: clamp(player.categoryRatings["Outside Scoring"]),
    finishing: clamp(player.categoryRatings["Inside Scoring"]),
    playmaking: clamp(player.categoryRatings.Playmaking),
    perimeterDefense: weighted(attributes, mapping.perimeterDefense),
    interiorDefense: weighted(attributes, mapping.interiorDefense),
    rebounding: clamp(player.categoryRatings.Rebounding),
    athleticism: clamp(player.categoryRatings.Athleticism),
    basketballIq: weighted(attributes, mapping.basketballIq),
  };
}

function hasCompleteProfile(player) {
  return hasCompleteCategories(player.categoryRatings)
    && Object.values(player.attributes ?? {}).every(Number.isFinite);
}

function potentialFromGrade(grade, overall, fallback, mapping) {
  return Math.max(overall, mapping.potentialByGrade[grade] ?? fallback ?? overall);
}

export function applyRatingsSnapshot(datasetInput, roster, ratings, mapping) {
  const dataset = structuredClone(datasetInput);
  const applied = applyRatingsToPlayers(dataset.players, roster, ratings, mapping);
  dataset.players = applied.players;
  const snapshotDate = ratings.snapshotVersion.split("-").slice(-3).join("-");
  dataset.players.sort((left, right) => Number(left.nbaPlayerId) - Number(right.nbaPlayerId));
  dataset.datasetVersion = `${dataset.datasetVersion.split("+nba2k27")[0]}+nba2k27-api-${snapshotDate}`;
  dataset.ratingModelVersion = "nba2k27-api-full-profile-map-v1";
  dataset.source.nba2k = {
    snapshotVersion: ratings.snapshotVersion,
    provider: ratings.source.provider,
    url: ratings.source.url,
    official: false,
    mappingVersion: mapping.version,
    syncedAt: ratings.capturedAt,
  };
  return { dataset, aligned: applied.aligned };
}

export function applyRatingsToPlayers(playersInput, roster, ratings, mapping) {
  const players = structuredClone(playersInput);
  const ratingByName = new Map(ratings.players.filter(hasCompleteProfile).map((player) => [playerNameKey(player.name), player]));
  const rosterById = new Map(roster.players.map((player) => [player.nbaPlayerId, player]));
  let aligned = 0;

  for (const player of players) {
    const rating = ratingByName.get(playerNameKey(player.fullName));
    if (rating) {
      const flags = (player.projection.qualityFlags ?? []).filter((flag) => !flag.startsWith("NBA_2K27_")
        && flag !== "NO_TRACKING_DEFENSE_FALLBACK");
      player.projection.attributes = mapAttributes(rating, mapping);
      player.projection.overall = rating.overall;
      player.projection.potential = potentialFromGrade(
        rating.potentialGrade,
        rating.overall,
        player.projection.potential,
        mapping,
      );
      player.projection.durability = clamp(rating.attributes["Overall Durability"]);
      player.projection.qualityFlags = [...flags, "NBA_2K27_FULL_PROFILE", "NBA_2K27_API_SNAPSHOT"];
      player.portraitPath = rating.portraitPath ?? player.portraitPath ?? null;
      aligned += 1;
    } else if (rosterById.has(player.nbaPlayerId)) {
      player.projection.qualityFlags = [...new Set([
        ...(player.projection.qualityFlags ?? []).filter((flag) => !flag.startsWith("NBA_2K27_")),
        "NBA_2K27_PROFILE_UNAVAILABLE",
      ])];
    }
  }
  return { players, aligned };
}

export function validatePlayerDataSync(dataset, roster, ratings, officialTop100 = null) {
  if (ratings.players.length < 500) throw new Error(`NBA2K snapshot is unexpectedly small (${ratings.players.length})`);
  const rosterById = new Map(roster.players.map((player) => [player.nbaPlayerId, player]));
  const currentPlayers = dataset.players.filter((player) => rosterById.has(player.nbaPlayerId));
  const alignedCurrent = currentPlayers.filter((player) => player.projection.qualityFlags.includes("NBA_2K27_FULL_PROFILE"));
  const coveragePercent = currentPlayers.length ? alignedCurrent.length / currentPlayers.length * 100 : 0;
  const overalls = dataset.players.map((player) => player.projection.overall);
  const averageOverall = overalls.reduce((sum, value) => sum + value, 0) / overalls.length;
  const elite90Plus = overalls.filter((value) => value >= 90).length;
  if (coveragePercent < 90) throw new Error(`Official-roster 2K coverage fell below 90% (${coveragePercent.toFixed(1)}%)`);
  if (averageOverall < 68 || averageOverall > 77) throw new Error(`Average OVR is outside 68–77 (${averageOverall.toFixed(2)})`);
  if (elite90Plus < 5 || elite90Plus > 25) throw new Error(`90+ player count is outside 5–25 (${elite90Plus})`);

  const ratingByName = new Map(ratings.players.map((player) => [playerNameKey(player.name), player]));
  const officialMatches = (officialTop100?.ratings ?? []).flatMap((player) => {
    const rating = ratingByName.get(playerNameKey(player.name));
    return rating ? [Math.abs(rating.overall - player.overall)] : [];
  });
  const officialMeanAbsoluteError = officialMatches.length
    ? officialMatches.reduce((sum, value) => sum + value, 0) / officialMatches.length
    : null;
  if (officialTop100 && officialMatches.length < 95) throw new Error(`Only ${officialMatches.length}/100 official Top 100 players matched`);
  if (officialMeanAbsoluteError !== null && officialMeanAbsoluteError > 1) {
    throw new Error(`Official Top 100 OVR mean absolute error is too high (${officialMeanAbsoluteError.toFixed(2)})`);
  }

  const rosterByName = new Map(roster.players.map((player) => [playerNameKey(player.fullName), player]));
  const apiTeamDisagreements = ratings.players.filter((player) => {
    const rosterPlayer = rosterByName.get(playerNameKey(player.name));
    const apiTeam = TEAM_ABBREVIATIONS.get(player.team);
    return rosterPlayer && apiTeam !== rosterPlayer.teamAbbreviation;
  }).length;

  return {
    schemaVersion: 1,
    snapshotVersion: ratings.snapshotVersion,
    snapshotPlayers: ratings.players.length,
    datasetPlayers: dataset.players.length,
    officialRosterPlayers: roster.players.length,
    currentPlayersWithDatasetRows: currentPlayers.length,
    currentPlayersAligned: alignedCurrent.length,
    currentCoveragePercent: Number(coveragePercent.toFixed(1)),
    averageOverall: Number(averageOverall.toFixed(2)),
    elite90Plus,
    officialTop100Matched: officialMatches.length,
    officialTop100MeanAbsoluteError: officialMeanAbsoluteError === null
      ? null
      : Number(officialMeanAbsoluteError.toFixed(3)),
    apiTeamDisagreementsIgnored: apiTeamDisagreements,
    teamAuthority: "nba-current-roster.json",
    fingerprint: createHash("sha256").update(JSON.stringify({
      snapshotVersion: ratings.snapshotVersion,
      players: ratings.players.map((player) => [player.slug, player.overall, player.lastUpdated]),
    })).digest("hex"),
  };
}
