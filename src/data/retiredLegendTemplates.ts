import { NBA_PLAYER_DATASET, type HistoricalPlayerTemplate } from "./nbaPlayerDataset";
import retiredLegend2kRatings from "./retiredLegend2kRatings.json";
import retiredLegendDesignRatings from "./retiredLegendDesignRatings.json";
import type { PlayerAttributes, PlayerTrait, Position } from "../game/state/types";
import { calculateAttributeOverall } from "../game/player/PlayerRatingService";

type Archetype = "CREATOR" | "SCORER" | "SHOOTER" | "SLASHER" | "DEFENDER" | "INTERIOR" | "REBOUNDER";
type LegendEntry = readonly [nbaId: string, name: string, chineseName: string, position: Position, archetype: Archetype, secondaryPosition?: Position];

// Curated retired NBA roster. NBA IDs identify the real player; the generated game ratings below
// are positional archetypes for gameplay and must not be presented as official NBA statistics.
const ROSTER: readonly LegendEntry[] = [
  ["76003", "Kareem Abdul-Jabbar", "卡里姆·阿卜杜尔-贾巴尔", "C", "INTERIOR"],
  ["951", "Ray Allen", "雷·阿伦", "SG", "SHOOTER"],
  ["2546", "Carmelo Anthony", "卡梅隆·安东尼", "SF", "SCORER"],
  ["76054", "Nate Archibald", "内特·阿奇博尔德", "PG", "CREATOR"],
  ["76056", "Paul Arizin", "保罗·阿里金", "SF", "SCORER"],
  ["787", "Charles Barkley", "查尔斯·巴克利", "PF", "REBOUNDER", "SF"],
  ["600013", "Rick Barry", "里克·巴里", "SF", "SCORER"],
  ["76127", "Elgin Baylor", "埃尔金·贝勒", "SF", "SLASHER"],
  ["76166", "Dave Bing", "戴夫·宾", "PG", "SCORER"],
  ["1449", "Larry Bird", "拉里·伯德", "SF", "SHOOTER"],
  ["977", "Kobe Bryant", "科比·布莱恩特", "SG", "SCORER"],
  ["76375", "Wilt Chamberlain", "威尔特·张伯伦", "C", "INTERIOR"],
  ["600003", "Bob Cousy", "鲍勃·库西", "PG", "CREATOR"],
  ["76462", "Dave Cowens", "戴夫·考恩斯", "C", "REBOUNDER"],
  ["76487", "Billy Cunningham", "比利·坎宁安", "PF", "SLASHER"],
  ["76545", "Dave DeBusschere", "戴夫·德布斯切尔", "PF", "DEFENDER"],
  ["17", "Clyde Drexler", "克莱德·德雷克斯勒", "SG", "SLASHER"],
  ["1495", "Tim Duncan", "蒂姆·邓肯", "PF", "INTERIOR"],
  ["76681", "Julius Erving", "朱利叶斯·欧文", "SF", "SLASHER"],
  ["121", "Patrick Ewing", "帕特里克·尤因", "C", "INTERIOR"],
  ["76750", "Walt Frazier", "沃尔特·弗雷泽", "PG", "DEFENDER"],
  ["708", "Kevin Garnett", "凯文·加内特", "PF", "DEFENDER"],
  ["76804", "George Gervin", "乔治·格文", "SG", "SCORER"],
  ["76882", "Hal Greer", "哈尔·格里尔", "SG", "SHOOTER"],
  ["76970", "John Havlicek", "约翰·哈夫利切克", "SF", "DEFENDER"],
  ["76979", "Elvin Hayes", "埃尔文·海耶斯", "PF", "INTERIOR"],
  ["947", "Allen Iverson", "阿伦·艾弗森", "SG", "SCORER", "PG"],
  ["77142", "Magic Johnson", "埃尔文·约翰逊", "PG", "CREATOR"],
  ["77196", "Sam Jones", "萨姆·琼斯", "SG", "SCORER"],
  ["893", "Michael Jordan", "迈克尔·乔丹", "SG", "SCORER"],
  ["467", "Jason Kidd", "杰森·基德", "PG", "CREATOR"],
  ["77418", "Jerry Lucas", "杰里·卢卡斯", "PF", "REBOUNDER"],
  ["252", "Karl Malone", "卡尔·马龙", "PF", "INTERIOR"],
  ["77449", "Moses Malone", "摩西·马龙", "C", "REBOUNDER"],
  ["77459", "Pete Maravich", "皮特·马拉维奇", "SG", "CREATOR"],
  ["77498", "Bob McAdoo", "鲍勃·麦卡杜", "C", "SCORER"],
  ["1450", "Kevin McHale", "凯文·麦克海尔", "PF", "INTERIOR"],
  ["600012", "George Mikan", "乔治·麦肯", "C", "INTERIOR"],
  ["397", "Reggie Miller", "雷吉·米勒", "SG", "SHOOTER", "SF"],
  ["600006", "Earl Monroe", "厄尔·门罗", "SG", "SCORER"],
  ["959", "Steve Nash", "史蒂夫·纳什", "PG", "CREATOR"],
  ["1717", "Dirk Nowitzki", "德克·诺维茨基", "PF", "SHOOTER"],
  ["406", "Shaquille O'Neal", "沙奎尔·奥尼尔", "C", "INTERIOR"],
  ["165", "Hakeem Olajuwon", "哈基姆·奥拉朱旺", "C", "DEFENDER"],
  ["305", "Robert Parish", "罗伯特·帕里什", "C", "INTERIOR"],
  ["101108", "Chris Paul", "克里斯·保罗", "PG", "CREATOR"],
  ["56", "Gary Payton", "加里·佩顿", "PG", "DEFENDER"],
  ["77847", "Bob Pettit", "鲍勃·佩蒂特", "PF", "REBOUNDER"],
  ["1718", "Paul Pierce", "保罗·皮尔斯", "SF", "SCORER"],
  ["937", "Scottie Pippen", "斯科蒂·皮蓬", "SF", "DEFENDER"],
  ["77929", "Willis Reed", "威利斯·里德", "C", "INTERIOR"],
  ["600015", "Oscar Robertson", "奥斯卡·罗伯特森", "PG", "CREATOR"],
  ["764", "David Robinson", "大卫·罗宾逊", "C", "DEFENDER"],
  ["23", "Dennis Rodman", "丹尼斯·罗德曼", "PF", "REBOUNDER"],
  ["78049", "Bill Russell", "比尔·拉塞尔", "C", "DEFENDER"],
  ["78076", "Dolph Schayes", "多尔夫·谢伊斯", "PF", "SCORER"],
  ["78126", "Bill Sharman", "比尔·沙曼", "SG", "SHOOTER"],
  ["304", "John Stockton", "约翰·斯托克顿", "PG", "CREATOR"],
  ["78318", "Isiah Thomas", "伊赛亚·托马斯", "PG", "CREATOR"],
  ["600001", "Nate Thurmond", "内特·瑟蒙德", "C", "DEFENDER"],
  ["78392", "Wes Unseld", "韦斯·昂塞尔德", "C", "REBOUNDER"],
  ["2548", "Dwyane Wade", "德维恩·韦德", "SG", "SLASHER"],
  ["78450", "Bill Walton", "比尔·沃顿", "C", "CREATOR"],
  ["78497", "Jerry West", "杰里·韦斯特", "SG", "SCORER"],
  ["201566", "Russell Westbrook", "拉塞尔·威斯布鲁克", "PG", "SLASHER"],
  ["78530", "Lenny Wilkens", "兰尼·威尔肯斯", "PG", "CREATOR"],
  ["1122", "Dominique Wilkins", "多米尼克·威尔金斯", "SF", "SLASHER"],
  ["1460", "James Worthy", "詹姆斯·沃西", "SF", "SLASHER"],
  ["2225", "Tony Parker", "托尼·帕克", "PG", "SLASHER"],
  ["1938", "Manu Ginobili", "马努·吉诺比利", "SG", "CREATOR"],
  ["2547", "Chris Bosh", "克里斯·波什", "PF", "INTERIOR"],
  ["1713", "Vince Carter", "文斯·卡特", "SG", "SLASHER"],
  ["1503", "Tracy McGrady", "特雷西·麦克格雷迪", "SG", "SCORER"],
  ["2397", "Yao Ming", "姚明", "C", "INTERIOR"],
  ["1112", "Ben Wallace", "本·华莱士", "C", "DEFENDER"],
  ["87", "Dikembe Mutombo", "迪肯贝·穆托姆博", "C", "DEFENDER"],
  ["255", "Grant Hill", "格兰特·希尔", "SF", "CREATOR"],
  ["2200", "Pau Gasol", "保罗·加索尔", "PF", "INTERIOR"],
  ["1497", "Chauncey Billups", "昌西·比卢普斯", "PG", "CREATOR"],
  ["185", "Chris Webber", "克里斯·韦伯", "PF", "CREATOR"],
  ["297", "Alonzo Mourning", "阿朗佐·莫宁", "C", "DEFENDER"],
  ["431", "Shawn Kemp", "肖恩·坎普", "PF", "SLASHER"],
  ["2405", "Amar'e Stoudemire", "阿玛雷·斯塔德迈尔", "PF", "SLASHER"],
  ["896", "Tim Hardaway", "蒂姆·哈达威", "PG", "CREATOR"],
  ["201565", "Derrick Rose", "德里克·罗斯", "PG", "SLASHER"],
  ["201933", "Blake Griffin", "布雷克·格里芬", "PF", "SLASHER"],
  ["200746", "LaMarcus Aldridge", "拉马库斯·阿尔德里奇", "PF", "SCORER"],
  ["201188", "Marc Gasol", "马克·加索尔", "C", "CREATOR"],
  ["200765", "Rajon Rondo", "拉简·朗多", "PG", "CREATOR"],
  ["201146", "Yi Jianlian", "易建联", "PF", "SHOOTER", "C"],
];

const BASE_ATTRIBUTES: Record<Position, PlayerAttributes> = {
  PG: { shooting: 71, finishing: 68, playmaking: 78, perimeterDefense: 68, interiorDefense: 55, rebounding: 56, athleticism: 72, basketballIq: 75 },
  SG: { shooting: 74, finishing: 71, playmaking: 68, perimeterDefense: 69, interiorDefense: 56, rebounding: 57, athleticism: 73, basketballIq: 73 },
  SF: { shooting: 71, finishing: 72, playmaking: 67, perimeterDefense: 70, interiorDefense: 64, rebounding: 66, athleticism: 72, basketballIq: 73 },
  PF: { shooting: 65, finishing: 75, playmaking: 63, perimeterDefense: 64, interiorDefense: 73, rebounding: 76, athleticism: 70, basketballIq: 72 },
  C: { shooting: 58, finishing: 77, playmaking: 60, perimeterDefense: 57, interiorDefense: 78, rebounding: 81, athleticism: 68, basketballIq: 71 },
};

const ATTRIBUTE_BONUSES: Record<Archetype, Partial<PlayerAttributes>> = {
  CREATOR: { playmaking: 7, basketballIq: 4 },
  SCORER: { shooting: 4, finishing: 4 },
  SHOOTER: { shooting: 8, basketballIq: 2 },
  SLASHER: { finishing: 6, athleticism: 5 },
  DEFENDER: { perimeterDefense: 5, interiorDefense: 5 },
  INTERIOR: { finishing: 5, interiorDefense: 4 },
  REBOUNDER: { rebounding: 7, interiorDefense: 3 },
};

const TRAIT_BY_ARCHETYPE: Record<Archetype, PlayerTrait> = {
  CREATOR: "PRIMARY_CREATOR",
  SCORER: "SECONDARY_CREATOR",
  SHOOTER: "SPACER",
  SLASHER: "SLASHER",
  DEFENDER: "TWO_WAY",
  INTERIOR: "RIM_PROTECTOR",
  REBOUNDER: "REBOUNDER",
};

const BODY_BY_POSITION: Record<Position, readonly [heightCm: number, weightKg: number]> = {
  PG: [190, 88], SG: [196, 94], SF: [202, 101], PF: [208, 109], C: [213, 116],
};

const existingTemplates = new Map(NBA_PLAYER_DATASET.historicalTemplates.map((template) => [template.sourcePlayerId, template]));
type SourcedPeak = { sourcePlayerId: string; peakOverall: number; peakAttributes: PlayerAttributes | null };
const peakRatingsById = new Map(
  (retiredLegend2kRatings.players as SourcedPeak[])
    .map((entry) => [entry.sourcePlayerId, entry]),
);
type SourcedPositions = { sourcePlayerId: string; positions?: string[] };
const sourcedPositionsById = new Map(
  (retiredLegend2kRatings.players as SourcedPositions[])
    .map((entry) => [entry.sourcePlayerId, entry.positions ?? []]),
);
const designPeaksById = new Map(retiredLegendDesignRatings.players.map((entry) => [entry.sourcePlayerId, entry.peakOverall]));

function archetypeTemplate([nbaId, name, , position, archetype, secondaryPosition]: LegendEntry): HistoricalPlayerTemplate {
  const base = BASE_ATTRIBUTES[position];
  const bonuses = ATTRIBUTE_BONUSES[archetype];
  const rookieAttributes = Object.fromEntries(
    (Object.keys(base) as Array<keyof PlayerAttributes>).map((key) => [key, base[key] + 3 + (bonuses[key] ?? 0)]),
  ) as unknown as PlayerAttributes;
  const [heightCm, weightKg] = BODY_BY_POSITION[position];
  const big = position === "PF" || position === "C";
  return {
    sourcePlayerId: `nba:${nbaId}`,
    sourceName: name,
    sourceSeason: "CURATED",
    peakSeason: "CURATED",
    era: "LEGEND",
    position,
    ...(secondaryPosition ? { secondaryPosition } : {}),
    heightCm,
    weightKg,
    rookieAttributes,
    // Design values, not measurements of the real player's rookie or peak season.
    peakOverall: 90,
    durability: 82,
    tendencies: {
      threeRate: archetype === "SHOOTER" ? 0.38 : big ? 0.15 : 0.25,
      assistRate: archetype === "CREATOR" ? 0.19 : position === "PG" ? 0.13 : 0.08,
      rimRate: archetype === "SHOOTER" ? 0.35 : big || archetype === "SLASHER" ? 0.58 : 0.47,
      usageTendency: archetype === "SCORER" || archetype === "SLASHER" ? 76 : 68,
    },
    traits: [TRAIT_BY_ARCHETYPE[archetype]],
    eligible: true,
  };
}

export const RETIRED_LEGEND_IDS = ROSTER.map(([nbaId]) => `nba:${nbaId}`);

export const RETIRED_LEGEND_NAMES_ZH: Record<string, string> = Object.fromEntries(
  ROSTER.map(([, name, chineseName]) => [name.toLowerCase(), chineseName]),
);

export const RETIRED_LEGEND_TEMPLATES: HistoricalPlayerTemplate[] = ROSTER.map((entry) => {
  const existing = existingTemplates.get(`nba:${entry[0]}`);
  const template = existing ? { ...existing, position: entry[3], eligible: true } : archetypeTemplate(entry);
  const sourcedSecondaryPosition = sourcedPositionsById.get(template.sourcePlayerId)
    ?.find((position): position is Position => position !== entry[3] && ["PG", "SG", "SF", "PF", "C"].includes(position));
  const secondaryPosition = sourcedSecondaryPosition ?? entry[5] ?? entry[3];
  const designPeak = designPeaksById.get(template.sourcePlayerId);
  if (designPeak !== undefined) return { ...template, secondaryPosition, peakOverall: designPeak };
  const sourcedPeak = peakRatingsById.get(template.sourcePlayerId);
  if (!sourcedPeak || !Number.isInteger(sourcedPeak.peakOverall) || sourcedPeak.peakOverall < 25 || sourcedPeak.peakOverall > 99) return { ...template, secondaryPosition };
  if (!sourcedPeak.peakAttributes || Object.values(sourcedPeak.peakAttributes).some((value) => !Number.isInteger(value) || value < 25 || value > 99)) {
    return { ...template, secondaryPosition, peakOverall: sourcedPeak.peakOverall };
  }
  // Historic rosters describe a mature player, not his debut year. Keep the
  // existing rookie OVR and borrow only the sourced eight-attribute shape.
  const rookieOverall = calculateAttributeOverall(template.rookieAttributes, template.position);
  const peakOverall = calculateAttributeOverall(sourcedPeak.peakAttributes, template.position);
  const adjustment = rookieOverall - peakOverall;
  const rookieAttributes = Object.fromEntries(
    (Object.keys(sourcedPeak.peakAttributes) as Array<keyof PlayerAttributes>).map((key) => [
      key,
      Math.max(25, Math.min(99, Math.round(sourcedPeak.peakAttributes![key] + adjustment))),
    ]),
  ) as unknown as PlayerAttributes;
  return { ...template, secondaryPosition, peakOverall: sourcedPeak.peakOverall, rookieAttributes };
});
