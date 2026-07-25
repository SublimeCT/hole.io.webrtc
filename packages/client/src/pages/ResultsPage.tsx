import { useEffect, useMemo, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";

import { loadMatchResult, type MatchResult, type MatchResultEntry } from "../app/matchResult";
import { getHoleProgress } from "@hole-io/shared/simulation";

const EMPTY_RESULT: MatchResult = {
  playerRank: 1,
  playerScore: 0,
  swallowCount: 0,
  eliminations: 0,
  elapsedSeconds: 0,
  maxRevives: 1,
  ranking: [
    { id: "player", name: "玩家", score: 0, isPlayer: true, isOut: false },
    { id: "bot-1", name: "雾岛", score: 0, isPlayer: false, isOut: false },
    { id: "bot-2", name: "夜枭", score: 0, isPlayer: false, isOut: false },
  ],
};

const AVATAR_STYLES: Record<string, CSSProperties> = {
  player: { background: "linear-gradient(135deg, var(--accent), #bff6ff)" },
  "bot-1": { background: "linear-gradient(135deg, #ff8a3d, #ffd2a8)" },
  "bot-2": { background: "linear-gradient(135deg, #5aa9e6, #cfe8fb)" },
};

const PLACE_LABELS = ["第一名", "第二名", "第三名"];

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remaining = safe % 60;
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}

function avatarInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed.charAt(0) || "·";
}

function levelTag(entry: MatchResultEntry): string {
  if (entry.isOut) {
    return `Lv.${getHoleProgress(entry.score).level + 1} · 已出局`;
  }
  const progress = getHoleProgress(entry.score);
  return `Lv.${progress.level + 1} · 半径 ${progress.radius.toFixed(1)}m`;
}

export function ResultsPage() {
  const navigate = useNavigate();
  const result = useMemo(() => loadMatchResult() ?? EMPTY_RESULT, []);

  const playerEntry = result.ranking.find((entry) => entry.isPlayer);
  const isOut = playerEntry?.isOut === true;
  const swallowCount = result.swallowCount ?? 0;
  const eliminations = result.eliminations ?? 0;
  const elapsedSeconds = result.elapsedSeconds ?? 0;
  const maxRevives = result.maxRevives ?? 1;
  const ranked = result.ranking.slice(0, 3);
  const maxLevel = getHoleProgress(result.playerScore).level + 1;
  const maxLevelRadius = getHoleProgress(result.playerScore).radius;

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey) return;
      if (event.code === "KeyR") {
        event.preventDefault();
        navigate("/game", { replace: true });
      } else if (event.code === "Escape") {
        event.preventDefault();
        navigate("/");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <main className={`results ${isOut ? "is-out" : "is-win"}`}>
      <div className="results-bg" aria-hidden="true">
        <div className="results-bg-city">
          <div className="results-bg-grid" />
          <div
            className="results-bg-road"
            style={{ left: 0, top: "30%", right: 0, height: "6%" }}
          />
          <div
            className="results-bg-road"
            style={{ left: 0, top: "62%", right: 0, height: "5.5%" }}
          />
          <div
            className="results-bg-road"
            style={{ left: "28%", top: 0, bottom: 0, width: "6%" }}
          />
          <div
            className="results-bg-road"
            style={{ left: "64%", top: 0, bottom: 0, width: "5.5%" }}
          />
          <div
            className="results-bg-block"
            style={{ left: "5%", top: "7%", width: "19%", height: "20%" }}
          />
          <div
            className="results-bg-block"
            style={{ left: "37%", top: "7%", width: "23%", height: "19%" }}
          />
          <div
            className="results-bg-block"
            style={{ left: "72%", top: "9%", width: "22%", height: "22%" }}
          />
          <div
            className="results-bg-block"
            style={{ left: "7%", top: "40%", width: "17%", height: "19%" }}
          />
          <div
            className="results-bg-block"
            style={{ left: "72%", top: "41%", width: "22%", height: "19%" }}
          />
          <div
            className="results-bg-block"
            style={{ left: "6%", top: "71%", width: "20%", height: "22%" }}
          />
          <div
            className="results-bg-block"
            style={{ left: "37%", top: "70%", width: "25%", height: "22%" }}
          />
          <div
            className="results-bg-block"
            style={{ left: "72%", top: "71%", width: "22%", height: "21%" }}
          />
          <div className="results-bg-hole" />
        </div>
      </div>

      <div className="results-wrap">
        <header className={`results-head ${isOut ? "is-out" : "is-win"}`}>
          <span className="results-head-kicker">{isOut ? "你已出局" : "本局胜利"}</span>
          <h1 className="results-head-title">
            排名 <span className="results-head-rank">#{result.playerRank}</span> / {ranked.length}
          </h1>
          <p className="results-head-sub">
            {isOut ? (
              <>
                第 <b>{Math.max(1, eliminations)}</b> 次阵亡 · 永久出局 · 用时{" "}
                <b>{formatDuration(elapsedSeconds)}</b>
              </>
            ) : (
              <>
                用时 <b>{formatDuration(elapsedSeconds)}</b> · 共吞噬 <b>{swallowCount}</b> 个目标 ·{" "}
                {eliminations} 次阵亡
              </>
            )}
          </p>
        </header>

        <div className="results-body">
          <section className="results-card">
            <h3 className="results-card-title">
              <span className="results-card-label">最终排名</span>
              <span>{ranked.length} 人</span>
            </h3>
            <ol className="results-leaderboard" aria-label="最终排名">
              {ranked.map((entry, index) => (
                <li
                  key={entry.id}
                  className={`results-row ${entry.isPlayer ? "is-me" : ""} ${index === 0 ? "is-first" : ""}`}
                >
                  <span className="results-row-rank">
                    {index + 1}
                    <svg className="results-row-crown" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M3 8l4 3 5-6 5 6 4-3-2 11H5L3 8z" />
                    </svg>
                  </span>
                  <span
                    className="results-row-avatar"
                    style={AVATAR_STYLES[entry.id] ?? AVATAR_STYLES["bot-2"]}
                  >
                    {avatarInitial(entry.name)}
                  </span>
                  <span className="results-row-name">
                    {entry.name}
                    {entry.isPlayer && !isOut ? "（你）" : ""}
                    <small className="results-row-meta">
                      <span className={`results-row-tag ${entry.isOut ? "is-out" : ""}`}>
                        {levelTag(entry)}
                      </span>
                    </small>
                  </span>
                  <span className="results-row-score">
                    {entry.score.toLocaleString()}
                    <small className="results-row-place">{PLACE_LABELS[index] ?? ""}</small>
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section className="results-card">
            <h3 className="results-card-title">
              <span className="results-card-label">本局数据</span>
            </h3>
            <div className="results-stats">
              <div className="results-stat">
                <div className="results-stat-label">最终分数</div>
                <div className="results-stat-value">{result.playerScore.toLocaleString()}</div>
              </div>
              <div className="results-stat">
                <div className="results-stat-label">最大等级</div>
                <div className="results-stat-value">
                  Lv.{maxLevel}
                  <small>· {maxLevelRadius.toFixed(1)}m</small>
                </div>
              </div>
              <div className="results-stat">
                <div className="results-stat-label">吞噬数</div>
                <div className="results-stat-value">{swallowCount}</div>
              </div>
              <div className="results-stat">
                <div className="results-stat-label">阵亡</div>
                <div className="results-stat-value">
                  {eliminations}
                  <small>/{maxRevives}</small>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="results-actions">
          <button
            className="results-btn results-btn-primary"
            type="button"
            onClick={() => navigate("/game", { replace: true })}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 4l13 8-13 8z" />
            </svg>
            重新开始
            <span className="results-btn-key">R</span>
          </button>
          <button
            className="results-btn"
            type="button"
            onClick={() => navigate("/", { replace: true })}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 11l9-8 9 8M5 10v10h14V10" />
            </svg>
            返回主页
            <span className="results-btn-key">Esc</span>
          </button>
        </div>
        <p className="results-hint">结算与对局中均可返回主页 · 按 R 立即重开</p>
      </div>
    </main>
  );
}
