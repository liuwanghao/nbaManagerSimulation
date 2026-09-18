import type { Player } from "../game/state/types";
import { currentPlayerNameZh, nbaPlayerIdFromCanonicalId } from "../data/currentPlayerNamesZh";

const COMMON_NAME_PARTS: Record<string, string> = {
  aaron: "阿龙", adam: "亚当", adams: "亚当斯", adebayo: "阿德巴约", aiden: "艾登", al: "艾尔", alex: "亚历克斯",
  allen: "阿伦", amen: "阿门", andre: "安德烈", andrew: "安德鲁", anthony: "安东尼", antetokounmpo: "阿德托昆博",
  ausar: "奥萨尔", austin: "奥斯汀", ayton: "艾顿", bam: "巴姆", barnes: "巴恩斯", barrett: "巴雷特",
  beal: "比尔", ben: "本", bennedict: "本尼迪克特", biyombo: "比永博", blake: "布莱克", bogdanovic: "博格达诺维奇",
  booker: "布克", brandon: "布兰登", bradley: "布拉德利", bridges: "布里奇斯", brook: "布鲁克", brooks: "布鲁克斯",
  banks: "班克斯", bennett: "本内特", brown: "布朗", bruce: "布鲁斯", brunson: "布伦森", buddy: "巴迪", butler: "巴特勒", cade: "凯德",
  caleb: "凯莱布", cam: "卡姆", capela: "卡佩拉", carter: "卡特", chris: "克里斯", christian: "克里斯蒂安",
  cj: "西杰", clarkson: "克拉克森", claxton: "克拉克斯顿", coby: "科比", coleman: "科尔曼", collins: "科林斯", conley: "康利",
  cunningham: "坎宁安", curry: "库里", damian: "达米安", daniel: "丹尼尔", davis: "戴维斯", deandre: "德安德烈",
  dejounte: "德章泰", demar: "德罗赞", deni: "德尼", dereck: "德里克", derrick: "德里克", desmond: "德斯蒙德",
  darius: "达里厄斯", devin: "德文", dillon: "狄龙", dinwiddie: "丁威迪", doncic: "东契奇", donovan: "多诺万", draymond: "德雷蒙德",
  durant: "杜兰特", edwards: "爱德华兹", eli: "伊莱", embiid: "恩比德", evan: "埃文", foster: "福斯特", fox: "福克斯", franz: "弗朗茨",
  fred: "弗雷德", garland: "加兰", gary: "加里", george: "乔治", giddey: "吉迪", gordon: "戈登",
  grant: "格兰特", green: "格林", harden: "哈登", harris: "哈里斯", hayes: "海斯", henderson: "亨德森",
  herro: "希罗", holiday: "霍勒迪", holmgren: "霍姆格伦", horford: "霍福德", ingram: "英格拉姆", isaac: "艾萨克",
  isaiah: "以赛亚", ivey: "艾维", jackson: "杰克逊", jalen: "杰伦", james: "詹姆斯", jamal: "贾马尔", jonah: "乔纳",
  jaren: "小贾伦", jarrett: "贾勒特", jaylen: "杰伦", jayson: "杰森", jerami: "杰拉米", jimmy: "吉米",
  joel: "乔尔", john: "约翰", johnson: "约翰逊", jonathan: "乔纳森", jordan: "乔丹", jrue: "朱",
  julian: "朱利安", julius: "朱利叶斯", keegan: "基根", kellan: "凯伦", kevin: "凯文", keyonte: "基扬特", klay: "克莱", kristaps: "克里斯塔普斯",
  kuzma: "库兹马", kyrie: "凯里", lamelo: "拉梅洛", lavine: "拉文", lebron: "勒布朗", leonard: "莱昂纳德",
  lillard: "利拉德", lonzo: "朗佐", lopez: "洛佩斯", lowry: "洛瑞", luka: "卢卡", markkanen: "马尔卡宁",
  lawson: "劳森", malik: "马利克", marcus: "马库斯", maxey: "马克西", micah: "迈卡", michael: "迈克尔", mikal: "米卡尔", miles: "迈尔斯", miller: "米勒",
  mitchell: "米切尔", mobley: "莫布利", morant: "莫兰特", murray: "穆雷", myles: "迈尔斯", naz: "纳兹",
  morris: "莫里斯", nesmith: "内史密斯", nikola: "尼古拉", noah: "诺亚", og: "欧吉", paolo: "保罗", pascal: "帕斯卡尔", paul: "保罗",
  pierce: "皮尔斯", poole: "普尔", porzingis: "波尔津吉斯", price: "普莱斯", randle: "兰德尔", reaves: "里夫斯", reed: "里德", robinson: "罗宾逊",
  russell: "拉塞尔", sabonis: "萨博尼斯", sengun: "申京", shai: "谢伊", siakam: "西亚卡姆", simmons: "西蒙斯",
  smart: "斯马特", stephen: "斯蒂芬", steph: "斯蒂芬", stewart: "斯图尔特", suggs: "萨格斯", sutton: "萨顿", tatum: "塔图姆",
  thompson: "汤普森", trae: "特雷", turner: "特纳", tyler: "泰勒", tyrese: "泰瑞斯", victor: "维克托",
  vucevic: "武切维奇", wagner: "瓦格纳", walker: "沃克", washington: "华盛顿", westbrook: "威斯布鲁克",
  warren: "沃伦", white: "怀特", wiggins: "维金斯", williams: "威廉姆斯", williamson: "威廉森", young: "杨", zach: "扎克",
  zion: "锡安",
};

const FULL_NAME_OVERRIDES: Record<string, string> = {
  "aday mara": "阿代·马拉",
  "adam flagler": "亚当·弗拉格勒",
  "aj dybantsa": "AJ·迪班萨",
  "alex karaban": "亚历克斯·卡拉班",
  "allen graves": "阿伦·格雷夫斯",
  "alpha diallo": "阿尔法·迪亚洛",
  "baba miller": "巴巴·米勒",
  "ben simmons": "本·西蒙斯",
  "bennett stirtz": "本内特·斯蒂尔茨",
  "bogoljub marković": "博戈柳布·马尔科维奇",
  "braden smith": "布雷登·史密斯",
  "brayden burries": "布雷登·伯里斯",
  "bruce thornton": "布鲁斯·桑顿",
  "bryce hopkins": "布莱斯·霍普金斯",
  "caleb wilson": "凯莱布·威尔逊",
  "cameron boozer": "卡梅伦·布泽尔",
  "cameron carr": "卡梅伦·卡尔",
  "cj mccollum": "CJ·麦科勒姆",
  "chris cenac jr.": "克里斯·塞纳克",
  "christian anderson": "克里斯蒂安·安德森",
  "dailyn swain": "戴林·斯温",
  "darius acuff jr.": "达里厄斯·阿库夫",
  "darryn peterson": "达林·彼得森",
  "dillon mitchell": "狄龙·米切尔",
  "ebuka okorie": "埃布卡·奥科里",
  "emanuel sharp": "伊曼纽尔·夏普",
  "ernest udeh, jr.": "欧内斯特·乌德",
  "georges niang": "乔治·尼昂",
  "hannes steinbach": "汉内斯·施泰因巴赫",
  "henri veesaar": "亨利·维萨尔",
  "isaiah evans": "以赛亚·埃文斯",
  "izaiyah nelson": "伊赛亚·尼尔森",
  "jaden bradley": "杰登·布拉德利",
  "jamarion sharp": "贾马里昂·夏普",
  "jayden quaintance": "杰登·奎因坦斯",
  "jaylin sellers": "杰林·塞勒斯",
  "joshua jefferson": "约书亚·杰斐逊",
  "karim lopez": "卡里姆·洛佩斯",
  "jack kayil": "杰克·卡伊尔",
  "ja'kobi gillespie": "贾科比·吉莱斯皮",
  "jaron pierre jr.": "杰伦·皮埃尔",
  "keaton wagler": "基顿·瓦格勒",
  "kingston flemings": "金斯顿·弗莱明斯",
  "klay thompson": "克莱·汤普森",
  "koa peat": "科阿·皮特",
  "kylan boswell": "凯兰·博斯韦尔",
  "lonnie walker iv": "朗尼·沃克",
  "labaron philon jr.": "拉巴隆·菲隆",
  "lajae jones": "拉杰·琼斯",
  "mario hezonja": "马里奥·海佐尼亚",
  "malique lewis": "马利克·刘易斯",
  "maliq brown": "马利克·布朗",
  "meleek thomas": "马利克·托马斯",
  "michael ajayi": "迈克尔·阿贾伊",
  "morez johnson jr.": "莫雷兹·约翰逊",
  "mikel brown jr.": "米克尔·布朗",
  "nate ament": "内特·阿门特",
  "narcisse ngoy": "纳西斯·恩戈伊",
  "nick martinelli": "尼克·马丁内利",
  "quadir copeland": "卡迪尔·科普兰",
  "otega oweh": "奥特加·奥韦",
  "rafael castro": "拉斐尔·卡斯特罗",
  "ryan conwell": "莱恩·康威尔",
  "richie saunders": "里奇·桑德斯",
  "sergio de larrea": "塞尔吉奥·德拉雷亚",
  "tarik biberovic": "塔里克·比贝罗维奇",
  "tarris reed jr.": "塔里斯·里德",
  "tobe awaka": "托比·阿瓦卡",
  "tobi lawal": "托比·拉瓦尔",
  "tre donaldson": "特雷·唐纳森",
  "trey kaufman-renn": "特雷·考夫曼-雷恩",
  "trevon brazile": "特雷冯·布拉泽尔",
  "trey lyles": "特雷·莱尔斯",
  "tyler bilodeau": "泰勒·比洛多",
  "tyler nickel": "泰勒·尼克尔",
  "ugonna onyenso": "乌戈纳·奥涅恩索",
  "vsevolod ishchenko": "弗谢沃洛德·伊先科",
  "felix okpara": "费利克斯·奥克帕拉",
  "yaxel lendeborg": "亚克塞尔·伦德博格",
  "zuby ejiofor": "祖比·埃吉奥福",
};

export function playerNameZh(name: string, canonicalPlayerId?: string): string {
  if (/\p{Script=Han}/u.test(name)) return name;
  const officialName = currentPlayerNameZh(nbaPlayerIdFromCanonicalId(canonicalPlayerId));
  if (officialName) return officialName;
  const normalizedName = name.trim().toLowerCase().replace(/\s+/gu, " ");
  if (FULL_NAME_OVERRIDES[normalizedName]) return FULL_NAME_OVERRIDES[normalizedName];
  const parts = name.match(/[A-Za-z]+/gu) ?? [];
  if (parts.length === 0) return "无名球员";
  const significantParts = parts.filter((part) => !["jr", "sr", "ii", "iii", "iv"].includes(part.toLowerCase()));
  if (significantParts.some((part) => !COMMON_NAME_PARTS[part.toLowerCase()])) return name;
  return significantParts.map((part) => COMMON_NAME_PARTS[part.toLowerCase()]).join("·");
}

export function localizePlayerNamesInText(text: string | undefined, players: Player[]): string {
  if (!text) return "";
  return players
    .filter((player) => player.name && !/\p{Script=Han}/u.test(player.name) && text.includes(player.name))
    .sort((left, right) => right.name.length - left.name.length)
    .reduce((localized, player) => localized.split(player.name).join(playerNameZh(player.name, player.id)), text);
}
