import type { GameState } from "../game/state/types";
import { localizePlayerNamesInText } from "./playerNameZh";

export function MarketTradeRecords({ userTrades, aiTrades, players }: {
  userTrades: GameState["gmCareer"]["tradeHistory"];
  aiTrades: GameState["aiTradeState"]["transactionLog"];
  players: GameState["players"];
}) {
  const roster = Object.values(players);
  const displaySummary = (summary: string) => localizePlayerNamesInText(summary, roster);
  return <div className="market-record-groups">
    <header className="manage-page-heading"><div><h2>交易记录</h2><p>我方交易与联盟其他球队的成交</p></div><span>{userTrades.length + aiTrades.length} 笔</span></header>
    <section className="manage-section-card"><div className="manage-section-heading"><div><h3>我方成交</h3></div><span>{userTrades.length} 笔</span></div><div className="market-record-list">{userTrades.length ? userTrades.slice().reverse().map((trade) => <article key={trade.offerId}><b>{trade.seasonId}</b><span>{displaySummary(trade.summary)}</span></article>) : <p className="manage-empty">尚未完成交易。</p>}</div></section>
    <section className="manage-section-card"><div className="manage-section-heading"><div><h3>联盟交易</h3></div><span>{aiTrades.length} 笔</span></div><div className="market-record-list">{aiTrades.length ? aiTrades.map((summary, index) => <article key={`${index}-${summary}`}><b>联盟</b><span>{displaySummary(summary)}</span></article>) : <p className="manage-empty">联盟球队尚无成交记录。</p>}</div></section>
  </div>;
}
