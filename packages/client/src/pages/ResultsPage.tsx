import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { loadMatchResult, type MatchResult } from "../app/matchResult";

const EMPTY_RESULT: MatchResult = {
  playerRank: 1,
  playerScore: 0,
  ranking: [
    { id: "player", name: "YOU", score: 0, isPlayer: true, isOut: false },
    { id: "bot-1", name: "BOT 01", score: 0, isPlayer: false, isOut: false },
    { id: "bot-2", name: "BOT 02", score: 0, isPlayer: false, isOut: false },
  ],
};

export function ResultsPage() {
  const navigate = useNavigate();
  const result = useMemo(() => loadMatchResult() ?? EMPTY_RESULT, []);

  useEffect(() => {
    const replay = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.code !== "KeyR") return;
      event.preventDefault();
      navigate("/game", { replace: true });
    };
    window.addEventListener("keydown", replay);
    return () => window.removeEventListener("keydown", replay);
  }, [navigate]);

  return (
    <main className="app-shell">
      <div className="screen-texture" aria-hidden="true" />
      <section className="overlay results-overlay">
        <div className="results-sheet">
          <header>
            <span className="result-mark">#</span>
            <div>
              <span className="kicker">MATCH COMPLETE</span>
              <h2>FINAL RANKING</h2>
            </div>
            <strong className="final-rank">{result.playerRank.toString().padStart(2, "0")}</strong>
          </header>
          <ol className="final-ranking" aria-label="最终排名">
            {result.ranking.slice(0, 3).map((entry, index) => (
              <li
                key={entry.id}
                className={`${entry.isPlayer ? "is-player" : ""} ${entry.isOut ? "is-out" : ""}`}
              >
                <span>{(index + 1).toString().padStart(2, "0")}</span>
                <i />
                <b>{entry.name}</b>
                <small>RANK</small>
                <em>{entry.score.toString().padStart(5, "0")}</em>
              </li>
            ))}
          </ol>
          <div className="result-metrics">
            <span>
              FINAL SCORE <b>{result.playerScore.toString().padStart(5, "0")}</b>
            </span>
          </div>
          <div className="command-row">
            <button
              className="primary-command"
              type="button"
              onClick={() => navigate("/game", { replace: true })}
            >
              <span>PLAY AGAIN</span>
              <b className="key-hint">R</b>
            </button>
            <button className="secondary-command" type="button" onClick={() => navigate("/")}>
              <span>返回主页</span>
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
