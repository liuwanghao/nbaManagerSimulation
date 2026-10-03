import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { clearLeaderboardReturn } from "./leaderboardReturn";

interface GameErrorBoundaryProps {
  children: ReactNode;
}

interface GameErrorBoundaryState {
  hasError: boolean;
  sessionKey: number;
}

export class GameErrorBoundary extends Component<GameErrorBoundaryProps, GameErrorBoundaryState> {
  state: GameErrorBoundaryState = { hasError: false, sessionKey: 0 };

  static getDerivedStateFromError(): Partial<GameErrorBoundaryState> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[GameErrorBoundary] 页面渲染异常", error, info.componentStack);
  }

  private returnHome = (): void => {
    clearLeaderboardReturn();
    this.setState((state) => ({ hasError: false, sessionKey: state.sessionKey + 1 }));
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return <main className="launcher-shell home-screen" style={{ justifyContent: "center" }}>
        <section className="home-load-menu" role="alert" aria-labelledby="game-render-error-title" style={{ maxWidth: 430 }}>
          <header><h1 id="game-render-error-title" style={{ margin: 0, fontSize: 20 }}>页面显示出现异常</h1></header>
          <div style={{ padding: 20 }}>
            <p style={{ margin: 0, lineHeight: 1.7 }}>当前存档仍保留。返回首页后，可重新读取存档继续游戏。</p>
            <div className="launcher-actions">
              <button type="button" className="launcher-primary" onClick={this.returnHome}><span>返回首页</span></button>
            </div>
          </div>
        </section>
      </main>;
    }

    return <Fragment key={this.state.sessionKey}>{this.props.children}</Fragment>;
  }
}
