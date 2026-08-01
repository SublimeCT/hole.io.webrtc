import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "zustand";

import { loadMatchResult, type MatchResult, type MatchResultEntry } from "../app/matchResult";
import { getHoleProgress } from "@hole-io/shared/simulation";
import { translate, type Language } from "../app/i18n";
import { loadPreferences } from "../app/preferences";
import { useMultiplayer } from "../net/MultiplayerProvider";
import { multiplayerStore } from "../store/multiplayerStore";

const ONLINE_RETURN_SECONDS = 8;

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

function levelTag(entry: MatchResultEntry, language: Language): string {
  if (entry.isOut) {
    return translate(language, "levelOut", { level: getHoleProgress(entry.score).level + 1 });
  }
  const progress = getHoleProgress(entry.score);
  return translate(language, "levelRadius", {
    level: progress.level + 1,
    radius: progress.radius.toFixed(1),
  });
}

export function ResultsPage() {
  const navigate = useNavigate();
  const language = loadPreferences().language;
  const localeNumber = new Intl.NumberFormat(language);
  const result = useMemo(() => loadMatchResult() ?? EMPTY_RESULT, []);
  const { session, disposeSession } = useMultiplayer();
  const room = useStore(multiplayerStore, (state) => state.room);
  const isOnline = session !== null && room !== null;
  const [countdown, setCountdown] = useState(ONLINE_RETURN_SECONDS);

  // 联机结算页「返回主页」= 离开房间：必须销毁会话（发 leave-room、关 WS/DataChannel/RTCPeerConnection），
  // 否则 MultiplayerProvider 包裹所有路由，会话会半死残留、host 仍显示与本机连接。
  const returnHome = useCallback((): void => {
    if (isOnline) disposeSession();
    navigate("/", { replace: true });
  }, [disposeSession, isOnline, navigate]);

  const playerEntry = result.ranking.find((entry) => entry.isPlayer);
  const isOut = playerEntry?.isOut === true;
  const swallowCount = result.swallowCount ?? 0;
  const eliminations = result.eliminations ?? 0;
  const elapsedSeconds = result.elapsedSeconds ?? 0;
  const maxRevives = result.maxRevives ?? 1;
  const ranked = result.ranking.slice(0, 3);
  const maxLevel = getHoleProgress(result.playerScore).level + 1;
  const maxLevelRadius = getHoleProgress(result.playerScore).radius;

  // 联机正常结束：8s 倒计时后自动回房间 lobby。
  useEffect(() => {
    if (!isOnline) return;
    if (countdown <= 0) {
      navigate("/online", { replace: true });
      return;
    }
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1_000);
    return () => window.clearTimeout(timer);
  }, [isOnline, countdown, navigate]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey) return;
      if (event.code === "KeyR") {
        if (isOnline) return; // 联机不重开离局
        event.preventDefault();
        navigate("/game", { replace: true });
      } else if (event.code === "Escape") {
        event.preventDefault();
        returnHome();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [returnHome, isOnline]);

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
          <span className="results-head-kicker">
            {translate(language, isOut ? "eliminated" : "victory")}
          </span>
          <h1 className="results-head-title">
            {translate(language, "rank")}{" "}
            <span className="results-head-rank">#{result.playerRank}</span> / {ranked.length}
          </h1>
          <p className="results-head-sub">
            {isOut ? (
              <>
                第 <b>{Math.max(1, eliminations)}</b> 次阵亡 · 永久出局 · 用时{" "}
                <b>{formatDuration(elapsedSeconds)}</b>
              </>
            ) : (
              <>
                {translate(language, "summary", {
                  time: formatDuration(elapsedSeconds),
                  count: swallowCount,
                  deaths: eliminations,
                })}
              </>
            )}
          </p>
        </header>

        <div className="results-body">
          <section className="results-card">
            <h3 className="results-card-title">
              <span className="results-card-label">{translate(language, "finalRanking")}</span>
              <span>{translate(language, "players", { count: ranked.length })}</span>
            </h3>
            <ol className="results-leaderboard" aria-label={translate(language, "finalRanking")}>
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
                    {entry.isPlayer && !isOut ? ` (${translate(language, "you")})` : ""}
                    <small className="results-row-meta">
                      <span className={`results-row-tag ${entry.isOut ? "is-out" : ""}`}>
                        {levelTag(entry, language)}
                      </span>
                    </small>
                  </span>
                  <span className="results-row-score">
                    {localeNumber.format(entry.score)}
                    <small className="results-row-place">
                      {translate(
                        language,
                        index === 0 ? "place1" : index === 1 ? "place2" : "place3",
                      )}
                    </small>
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section className="results-card">
            <h3 className="results-card-title">
              <span className="results-card-label">{translate(language, "matchData")}</span>
            </h3>
            <div className="results-stats">
              <div className="results-stat">
                <div className="results-stat-label">{translate(language, "finalScore")}</div>
                <div className="results-stat-value">{localeNumber.format(result.playerScore)}</div>
              </div>
              <div className="results-stat">
                <div className="results-stat-label">{translate(language, "maxLevel")}</div>
                <div className="results-stat-value">
                  Lv.{maxLevel}
                  <small>· {maxLevelRadius.toFixed(1)}m</small>
                </div>
              </div>
              <div className="results-stat">
                <div className="results-stat-label">{translate(language, "swallowed")}</div>
                <div className="results-stat-value">{swallowCount}</div>
              </div>
              <div className="results-stat">
                <div className="results-stat-label">{translate(language, "deaths")}</div>
                <div className="results-stat-value">
                  {eliminations}
                  <small>/{maxRevives}</small>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="results-actions">
          {isOnline ? (
            <button
              className="results-btn results-btn-primary"
              type="button"
              onClick={() => navigate("/online", { replace: true })}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 4l13 8-13 8z" />
              </svg>
              {translate(language, "backToRoom")}
              <span className="results-btn-key">{countdown}s</span>
            </button>
          ) : (
            <button
              className="results-btn results-btn-primary"
              type="button"
              onClick={() => navigate("/game", { replace: true })}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 4l13 8-13 8z" />
              </svg>
              {translate(language, "restart")}
              <span className="results-btn-key">R</span>
            </button>
          )}
          <button className="results-btn" type="button" onClick={returnHome}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 11l9-8 9 8M5 10v10h14V10" />
            </svg>
            {translate(language, "home")}
            <span className="results-btn-key">Esc</span>
          </button>
        </div>
        <p className="results-hint">
          {isOnline ? translate(language, "onlineResultsHint") : translate(language, "resultsHint")}
        </p>
      </div>
    </main>
  );
}
