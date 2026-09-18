export interface TeamBranding {
  sourceTeamId: string;
  name: string;
  fullName: string;
  englishName: string;
  logoUrl: string;
  dayColor: string;
  nightColor: string;
  arena: string;
}

// These files are local caches of the user-provided HoopChina CDN assets. Direct hotlinking
// returns 403 in browsers, so the game uses stable same-origin paths during fixture development.
const logo = (fileName: string): string => `./team-logos/${fileName}`;

export const EXISTING_TEAM_BRANDING: Record<string, TeamBranding> = {
  DET: { sourceTeamId: "1901000000501290", name: "活塞", fullName: "底特律活塞", englishName: "Pistons", logoUrl: logo("6A7BB8949E29F7F8ACC490BF3DC54871_1657174191189.png"), dayColor: "DB0832", nightColor: "DB0832", arena: "小凯撒球馆" },
  BOS: { sourceTeamId: "1901000000501263", name: "凯尔特人", fullName: "波士顿凯尔特人", englishName: "Celtics", logoUrl: logo("71D849840DAA77FFF62B68E1FC195E3B_1657174014644.png"), dayColor: "008348", nightColor: "008348", arena: "TD花园" },
  NYK: { sourceTeamId: "1901000000501273", name: "尼克斯", fullName: "纽约尼克斯", englishName: "Knicks", logoUrl: logo("44086A23B5EA9ED18D57141ED11FEC73_1657174040467.png"), dayColor: "FA5D0E", nightColor: "F58426", arena: "麦迪逊广场花园" },
  CLE: { sourceTeamId: "1901000000501288", name: "骑士", fullName: "克里夫兰骑士", englishName: "Cavaliers", logoUrl: logo("59FDBC2FC2EF63E464556ABF140D2B28_1657174182897.png"), dayColor: "BC945C", nightColor: "BC945C", arena: "火箭按揭球馆" },
  TOR: { sourceTeamId: "1901000000501298", name: "猛龙", fullName: "多伦多猛龙", englishName: "Raptors", logoUrl: logo("2C4E5806829643C2BBAEA95E8639E9DA_1657174236162.png"), dayColor: "7543A3", nightColor: "7543A3", arena: "加拿大丰业银行球馆" },
  ATL: { sourceTeamId: "1901000000501284", name: "老鹰", fullName: "亚特兰大老鹰", englishName: "Hawks", logoUrl: logo("51AA3EE81B8EDCE8EB8C81E5D86F099C_1657175154482.png"), dayColor: "BC0025", nightColor: "BC0025", arena: "州立农业球馆" },
  PHI: { sourceTeamId: "1901000000501281", name: "76人", fullName: "费城76人", englishName: "76ers", logoUrl: logo("12B3514277DE16CA223C87F52B3E59B0_1657173522873.png"), dayColor: "17A4F5", nightColor: "1D428A", arena: "Xfinity Mobile球馆" },
  ORL: { sourceTeamId: "1901000000501279", name: "魔术", fullName: "奥兰多魔术", englishName: "Magic", logoUrl: logo("93243F473635E01157407E937901BB29_1657174048221.png"), dayColor: "0077C0", nightColor: "0077C0", arena: "起亚中心" },
  CHA: { sourceTeamId: "1901000000501334", name: "黄蜂", fullName: "夏洛特黄蜂", englishName: "Hornets", logoUrl: logo("6A38E35A125B4DF0D0457690887F433B_1657174260380.png"), dayColor: "0099B2", nightColor: "00788C", arena: "光谱中心" },
  MIA: { sourceTeamId: "1901000000501267", name: "热火", fullName: "迈阿密热火", englishName: "Heat", logoUrl: logo("FC92B35C74B6870C871DD2DCB95B8A86_1657174030720.png"), dayColor: "EB8808", nightColor: "F9A01B", arena: "凯西亚中心球馆" },
  MIL: { sourceTeamId: "1901000000501294", name: "雄鹿", fullName: "密尔沃基雄鹿", englishName: "Bucks", logoUrl: logo("83283E33B2707E04FA29BDEC215D7505_1657174217476.png"), dayColor: "204224", nightColor: "476F49", arena: "Fiserv广场球馆" },
  CHI: { sourceTeamId: "1901000000501286", name: "公牛", fullName: "芝加哥公牛", englishName: "Bulls", logoUrl: logo("0A52DFC33FBDC999CDB56544F9CB313B_1657174167443.png"), dayColor: "FA0808", nightColor: "CE1141", arena: "联合中心" },
  BKN: { sourceTeamId: "1901000000501336", name: "篮网", fullName: "布鲁克林篮网", englishName: "Nets", logoUrl: logo("5D461E37576BA053CB96D299B29E2BFD_1657174252146.png"), dayColor: "3C4856", nightColor: "707271", arena: "巴克莱中心" },
  IND: { sourceTeamId: "1901000000501292", name: "步行者", fullName: "印第安纳步行者", englishName: "Pacers", logoUrl: logo("32CEB6FF938C838CB896E931ACF5D871_1657174208634.png"), dayColor: "000B5C", nightColor: "FDBB30", arena: "甘布里吉球馆" },
  WAS: { sourceTeamId: "1901000000501283", name: "奇才", fullName: "华盛顿奇才", englishName: "Wizards", logoUrl: logo("977768CE19436649A4A103804C7BA6FF_1657174059344.png"), dayColor: "74829F", nightColor: "74829F", arena: "第一资本竞技馆" },
  OKC: { sourceTeamId: "1901000000501329", name: "雷霆", fullName: "俄克拉荷马雷霆", englishName: "Thunder", logoUrl: logo("55E682ADE2434D37F470CCEF3D2EF212_1657173583291.png"), dayColor: "FF5015", nightColor: "FF5015", arena: "Paycom中心" },
  SAS: { sourceTeamId: "1901000000501317", name: "马刺", fullName: "圣安东尼奥马刺", englishName: "Spurs", logoUrl: logo("4805E990F70CA26727E538FD0208ADAC_1657686884877.png"), dayColor: "10394E", nightColor: "507081", arena: "AT&T 中心" },
  DEN: { sourceTeamId: "1901000000501301", name: "掘金", fullName: "丹佛掘金", englishName: "Nuggets", logoUrl: logo("BF833EF7FCA7FA7103467F0A9FB98DD7_1657194370775.png"), dayColor: "0E3C70", nightColor: "0E3C70", arena: "波尔中心" },
  LAL: { sourceTeamId: "1901000000501323", name: "湖人", fullName: "洛杉矶湖人", englishName: "Lakers", logoUrl: logo("708BC902E00BBD439A1C892A0D58F381_1657174320036.png"), dayColor: "5F1B95", nightColor: "8866A8", arena: "Crypto球馆" },
  HOU: { sourceTeamId: "1901000000501311", name: "火箭", fullName: "休斯顿火箭", englishName: "Rockets", logoUrl: logo("2F9056A916907A1FCF3C8DB98292B600_1657174365689.png"), dayColor: "940A09", nightColor: "B91640", arena: "丰田中心" },
  MIN: { sourceTeamId: "1901000000501315", name: "森林狼", fullName: "明尼苏达森林狼", englishName: "Timberwolves", logoUrl: logo("DD0D5B42D50F2816B71D4C87059A1E7D_1657174355703.png"), dayColor: "0E6697", nightColor: "0E6697", arena: "标靶中心" },
  PHX: { sourceTeamId: "1901000000501327", name: "太阳", fullName: "菲尼克斯太阳", englishName: "Suns", logoUrl: logo("0318B0B694F80E0F873B0A4714470D58_1657174298893.png"), dayColor: "CC4C0D", nightColor: "E56020", arena: "足迹中心" },
  POR: { sourceTeamId: "1901000000501325", name: "开拓者", fullName: "波特兰开拓者", englishName: "Trail Blazers", logoUrl: logo("EFDBB64E572063C35921A7270445F4E9_1657686875832.png"), dayColor: "E03A3E", nightColor: "E03A3E", arena: "摩达中心" },
  LAC: { sourceTeamId: "1901000000501333", name: "快船", fullName: "洛杉矶快船", englishName: "Clippers", logoUrl: logo("455AEC22C5CCAF97E9176F7C3183272F_1744516408048.png"), dayColor: "8A9AAE", nightColor: "8A9AAE", arena: "Intuit Dome球馆" },
  GSW: { sourceTeamId: "1901000000501331", name: "勇士", fullName: "金州勇士", englishName: "Warriors", logoUrl: logo("D48624DA509B5BBC4B447DCBDC496B71_1698746059833.png"), dayColor: "003BAD", nightColor: "617BAD", arena: "大通中心" },
  NOP: { sourceTeamId: "1901000000501296", name: "鹈鹕", fullName: "新奥尔良鹈鹕", englishName: "Pelicans", logoUrl: logo("0595E22C1AF2A5569283C44AF2018A99_1657174225999.png"), dayColor: "0C2340", nightColor: "2D4666", arena: "冰沙王中心" },
  DAL: { sourceTeamId: "1901000000501300", name: "独行侠", fullName: "达拉斯独行侠", englishName: "Mavericks", logoUrl: logo("D7D19A2B49E6DBE3772809B9AFDC4DD0_1657690785182.png"), dayColor: "1D3FE0", nightColor: "0064B1", arena: "美国航空中心" },
  MEM: { sourceTeamId: "1901000000501313", name: "灰熊", fullName: "孟菲斯灰熊", englishName: "Grizzlies", logoUrl: logo("4702CB9A44715817306465D157774A72_1657686863936.png"), dayColor: "7998CE", nightColor: "7998CE", arena: "联邦快递球馆" },
  SAC: { sourceTeamId: "1901000000501321", name: "国王", fullName: "萨克拉门托国王", englishName: "Kings", logoUrl: logo("CD470E4CE6F96B896B65125FB9482F4B_1657174333052.png"), dayColor: "9B5AC9", nightColor: "9B5AC9", arena: "黄金一号中心" },
  UTA: { sourceTeamId: "1901000000501320", name: "爵士", fullName: "犹他爵士", englishName: "Jazz", logoUrl: logo("9CA4183AF78F085879786BF8BE23E1E3_1657173460899.png"), dayColor: "377346", nightColor: "377346", arena: "威英特智能家居球馆" },
};
