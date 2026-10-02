import { useState } from "react";
import type { GameState } from "../game/state/types";
import { localizePlayerNamesInText } from "./playerNameZh";

export function MarketTradeRecords({ userTrades, aiTrades, renewalRecords, players }: {
  userTrades: GameState["gmCareer"]["tradeHistory"];
  aiTrades: GameState["aiTradeState"]["transactionLog"];
  renewalRecords?: string[];
  players: GameState["players"];
}) {
  const [tab, setTab] = useState<"trades" | "renewals">("trades");
  const roster = Object.values(players);
  const displaySummary = (summary: string) => localizePlayerNamesInText(summary, roster);
  const renewals = renewalRecords ?? [];
  return <div className="market-record-groups">
    <header className="manage-page-heading"><div><h2>交易 / 续约记录</h2><p>查看我方交易、联盟交易，以及球队提前续约</p></div><span>{userTrades.length + aiTrades.length + renewals.length} 笔</span></header>
    <div className="market-record-tabs" role="tablist" aria-label="交易和续约记录"><button type="button" role="tab" id="market-record-tab-trades" aria-controls="market-record-panel-trades" aria-selected={tab === "trades"} tabIndex={tab === "trades" ? 0 : -1} className={tab === "trades" ? "selected" : ""} onClick={() => setTab("trades")}>交易 <span>{userTrades.length + aiTrades.length}</span></button><button type="button" role="tab" id="market-record-tab-renewals" aria-controls="market-record-panel-renewals" aria-selected={tab === "renewals"} tabIndex={tab === "renewals" ? 0 : -1} className={tab === "renewals" ? "selected" : ""} onClick={() => setTab("renewals")}>续约 <span>{renewals.length}</span></button></div>
    <div id="market-record-panel-trades" hidden={tab !== "trades"} role="tabpanel" aria-labelledby="market-record-tab-trades"><section className="manage-section-card"><div className="manage-section-heading"><div><h3>我方成交</h3></div><span>{userTrades.length} 笔</span></div><div className="market-record-list">{userTrades.length ? userTrades.slice().reverse().map((trade) => <article key={trade.offerId}><b>{trade.seasonId}</b><span>{displaySummary(trade.summary)}</span></article>) : <p className="manage-empty">尚未完成交易。</p>}</div></section>
    <section className="manage-section-card"><div className="manage-section-heading"><div><h3>联盟交易</h3></div><span>{aiTrades.length} 笔</span></div><div className="market-record-list">{aiTrades.length ? aiTrades.map((summary, index) => <article key={`${index}-${summary}`}><b>联盟</b><span>{displaySummary(summary)}</span></article>) : <p className="manage-empty">联盟球队尚无成交记录。</p>}</div></section></div>
    <section id="market-record-panel-renewals" className="manage-section-card" hidden={tab !== "renewals"} role="tabpanel" aria-labelledby="market-record-tab-renewals"><div className="manage-section-heading"><div><h3>提前续约</h3></div><span>{renewals.length} 笔</span></div><div className="market-record-list">{renewals.length ? renewals.slice().reverse().map((summary, index) => <article key={`${index}-${summary}`}><b>续约</b><span>{displaySummary(summary)}</span></article>) : <p className="manage-empty">暂无提前续约记录。</p>}</div></section>
  </div>;
}
