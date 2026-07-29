import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "zustand";
import type { RoomPeer } from "@hole-io/shared/protocol";

import { saveMatchResult, type MatchResult } from "../app/matchResult";
import { loadPreferences } from "../app/preferences";
import { translate } from "../app/i18n";
import { Game, type AbilityButtonUi, type GameUi, type OpponentIndicatorUi } from "../game/Game";
import { useMultiplayer } from "../net/MultiplayerProvider";
import { OnlineGameDriver } from "../net/onlineGameDriver";
import { multiplayerStore, type SessionTermination } from "../store/multiplayerStore";
import { VoidWordmark } from "../ui/VoidWordmark";

/** 联机会话终止原因 → 屏幕底部提示文案。 */
function terminationMessage(termination: SessionTermination): string {
  switch (termination) {
    case "host-left":
      return "房主已退出游戏";
    case "host-timeout":
      return "房主连接超时，游戏已结束";
    case "kicked":
      return "你已被房主移出房间";
    case "idle":
      return "房间等待超时，已解散";
    case "server-shutdown":
      return "服务器维护，房间已关闭";
    default:
      return "房间已关闭";
  }
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

function collectGameUi(): GameUi {
  const opponentIndicators: OpponentIndicatorUi[] = [];
  for (let i = 0; i < 4; i++) {
    const root = document.querySelector<HTMLElement>(`#opponent-${i}-indicator`);
    const arrow = document.querySelector<HTMLElement>(`#opponent-${i}-arrow`);
    const distance = document.querySelector<HTMLElement>(`#opponent-${i}-distance`);
    const name = document.querySelector<HTMLElement>(`#opponent-${i}-name`);
    if (root && arrow && distance) {
      if (name) {
        opponentIndicators.push({ root, arrow, distance, name });
      } else {
        opponentIndicators.push({ root, arrow, distance });
      }
    }
  }

  return {
    score: requireElement("#score"),
    radius: requireElement("#radius"),
    sizeLevel: requireElement("#size-level"),
    growthCopy: requireElement("#growth-copy"),
    growthFill: requireElement("#growth-fill"),
    time: requireElement("#time"),
    timerRoot: requireElement("#timer-root"),
    fps: requireElement("#fps"),
    rankingRows: Array.from({ length: 5 }, (_, index) => ({
      root: requireElement(`#rank-${index}`),
      position: requireElement(`#rank-${index}-position`),
      avatar: requireElement(`#rank-${index}-avatar`),
      name: requireElement(`#rank-${index}-name`),
      meta: requireElement(`#rank-${index}-meta`),
      score: requireElement(`#rank-${index}-score`),
    })),
    dragPad: requireElement("#drag-pad"),
    dragKnob: requireElement("#drag-knob"),
    loading: requireElement("#loading"),
    loadingBar: requireElement("#loading-bar"),
    loadingStatus: requireElement("#loading-status"),
    scoreEffects: requireElement("#score-effects"),
    opponentIndicators,
    abilityButtons: [
      {
        root: requireElement<HTMLButtonElement>("#ability-speed"),
        cooldown: requireElement("#ability-speed-cooldown"),
        status: requireElement("#ability-speed-status"),
      },
      {
        root: requireElement<HTMLButtonElement>("#ability-radius"),
        cooldown: requireElement("#ability-radius-cooldown"),
        status: requireElement("#ability-radius-status"),
      },
      {
        root: requireElement<HTMLButtonElement>("#ability-bomb"),
        cooldown: requireElement("#ability-bomb-cooldown"),
        status: requireElement("#ability-bomb-status"),
      },
    ] as readonly [AbilityButtonUi, AbilityButtonUi, AbilityButtonUi],
    abilityFeedback: requireElement("#ability-feedback"),
    powerUpLayer: requireElement("#power-up-layer"),
  };
}

export default function GamePage() {
  const navigate = useNavigate();
  const preferences = loadPreferences();
  const language = preferences.language;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [poopRain, setPoopRain] = useState<
    readonly { id: number; size: number; left: number; delay: number }[]
  >([]);
  const [exitToast, setExitToast] = useState("");
  const { session, disposeSession } = useMultiplayer();
  const matchId = useStore(multiplayerStore, (state) => state.matchId);
  const roomStatus = useStore(multiplayerStore, (state) => state.room?.status ?? null);
  const room = useStore(multiplayerStore, (state) => state.room);
  const termination = useStore(multiplayerStore, (state) => state.termination);
  const isOnline = session !== null && matchId !== null && roomStatus === "playing";

  // 对局结束幂等守卫：本地 Game.onMatchEnd 与 matchId 监听安全网都可能触发，只取首触发。
  const matchEndedRef = useRef(false);
  const driverRef = useRef<OnlineGameDriver | null>(null);
  const latestResultRef = useRef<MatchResult | null>(null);
  const prevMatchIdRef = useRef<string | null>(matchId);
  const prevPeersRef = useRef<readonly RoomPeer[]>(room?.peers ?? []);
  const exitToastTimer = useRef<number | null>(null);

  const showExitToast = useCallback((message: string): void => {
    setExitToast(message);
    if (exitToastTimer.current !== null) window.clearTimeout(exitToastTimer.current);
    exitToastTimer.current = window.setTimeout(() => setExitToast(""), 3_200);
  }, []);

  const handleMatchEnd = useCallback(
    (result: MatchResult): void => {
      if (matchEndedRef.current) return;
      matchEndedRef.current = true;
      latestResultRef.current = result;
      saveMatchResult(result);
      navigate("/results", { replace: true });
    },
    [navigate],
  );

  const returnHome = (): void => {
    if (isOnline && !window.confirm(translate(language, "exitOnlineConfirm"))) return;
    if (isOnline) disposeSession();
    navigate("/");
  };

  // 房间解散 / 被踢：回主页（必须 disposeSession，否则 session 半死、回 /online 无法重连）。
  useEffect(() => {
    if (termination === null || matchEndedRef.current) return;
    showExitToast(terminationMessage(termination));
    disposeSession();
    navigate("/", { replace: true });
  }, [termination, disposeSession, navigate, showExitToast]);

  // 正常结束安全网：服务器 match-ended 可能比 host 的 finished 快照先到、peer 连接已关，
  // 导致 guest 的 Game.onMatchEnd 不触发。监听 matchId null 化时用最近结果/当前 state 兜底。
  useEffect(() => {
    const prev = prevMatchIdRef.current;
    prevMatchIdRef.current = matchId;
    if (prev === null || matchId !== null) return;
    if (matchEndedRef.current || termination !== null) return;
    const fallback =
      latestResultRef.current ?? driverRef.current?.game?.buildCurrentMatchResult() ?? null;
    if (fallback !== null) {
      handleMatchEnd(fallback);
    } else {
      navigate("/online", { replace: true });
    }
  }, [matchId, termination, handleMatchEnd, navigate]);

  // 玩家中途退出提示：对局中某非 host peer 消失时底部 toast（留在对局）。
  useEffect(() => {
    const peers = room?.peers ?? [];
    if (isOnline && roomStatus === "playing" && termination === null) {
      for (const old of prevPeersRef.current) {
        if (old.isHost) continue;
        if (!peers.some((peer) => peer.peerId === old.peerId)) {
          showExitToast(`${old.profile.playerName} 已退出游戏`);
        }
      }
    }
    prevPeersRef.current = peers;
  }, [room?.peers, isOnline, roomStatus, termination, showExitToast]);

  useEffect(() => {
    return () => {
      if (exitToastTimer.current !== null) window.clearTimeout(exitToastTimer.current);
    };
  }, []);

  useEffect(() => {
    const gameCanvas = canvas.current;
    if (!gameCanvas) return;
    let disposed = false;
    let activeCleanup: (() => void) | null = null;

    const handlePoopHit = (playerCount: number): void => {
      setPoopRain(
        Array.from({ length: playerCount * 10 }, (_, id) => ({
          id,
          size: 60 + Math.random() * 120,
          left: Math.random() * 100,
          delay: Math.random() * 0.9,
        })),
      );
      window.setTimeout(() => setPoopRain([]), 3_000);
    };

    if (isOnline) {
      if (session === null) return;
      const driver = new OnlineGameDriver({
        session,
        canvas: gameCanvas,
        ui: collectGameUi(),
        preferences,
        onMatchEnd: handleMatchEnd,
        onPoopHit: handlePoopHit,
      });
      driverRef.current = driver;
      driver.start().catch((error: unknown) => {
        const status = document.querySelector<HTMLElement>("#loading-status");
        if (status) status.textContent = translate(language, "loadError");
        console.error(error);
      });
      activeCleanup = () => driver.dispose();
    } else {
      let game: Game | null = null;
      Game.create(gameCanvas, collectGameUi(), preferences, handleMatchEnd, handlePoopHit)
        .then((createdGame) => {
          if (disposed) {
            createdGame.dispose();
            return;
          }
          game = createdGame;
          game.start();
        })
        .catch((error: unknown) => {
          const status = document.querySelector<HTMLElement>("#loading-status");
          if (status) status.textContent = translate(language, "loadError");
          console.error(error);
        });
      activeCleanup = () => {
        disposed = true;
        game?.dispose();
      };
    }

    return () => activeCleanup?.();
  }, [isOnline, session, language, navigate, handleMatchEnd]);

  return (
    <main className="app-shell">
      <canvas ref={canvas} className="game-canvas" aria-label={translate(language, "gameScene")} />
      <div id="power-up-layer" className="power-up-layer" aria-hidden="true" />
      <div className="poop-rain" aria-hidden="true">
        {poopRain.map((poop) => (
          <span
            key={poop.id}
            style={{
              left: `${poop.left}%`,
              fontSize: `${poop.size}px`,
              animationDelay: `${poop.delay}s`,
            }}
          >
            💩
          </span>
        ))}
      </div>

      <div id="loading" className="loading" role="status" aria-live="polite">
        <div className="loading-content">
          <span className="kicker">{translate(language, "connecting")}</span>
          <VoidWordmark />
          <div className="loading-track">
            <i id="loading-bar" />
          </div>
          <span id="loading-status" className="loading-status">
            00 / 00
          </span>
        </div>
      </div>

      <header className="hud-top" aria-label={translate(language, "gameStatus")}>
        <button
          className="hud-home"
          type="button"
          aria-label={translate(language, "home")}
          title={translate(language, "home")}
          onClick={returnHome}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 11l9-8 9 8M5 10v10h14V10" />
          </svg>
        </button>

        <div id="timer-root" className="hud-timer" aria-label={translate(language, "remaining")}>
          <span id="time">3:00</span>
        </div>

        <section className="hud-rank" aria-label={translate(language, "rankingLive")}>
          <div className="hud-rank-header">
            <span>{translate(language, "rankingLive")}</span>
            <span>{translate(language, "players", { count: 3 })}</span>
          </div>
          {[0, 1, 2, 3, 4].map((index) => (
            <RankRow key={index} index={index} points={translate(language, "points")} />
          ))}
        </section>
      </header>

      <div className="hud-arrows" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <OpponentIndicator key={index} index={index} />
        ))}
      </div>

      <div className="hud-controls">
        <div className="hud-kbd" aria-hidden="true">
          <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd>
          <span>{translate(language, "move")}</span>
        </div>
        <div className="hud-skills">
          <SkillButton
            id="speed"
            keyName="Q"
            label={translate(language, "speed")}
            ariaLabel={translate(language, "speedAria")}
            icon={
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 6l6 6-6 6M12 6l6 6-6 6" />
              </svg>
            }
          />
          <SkillButton
            id="radius"
            keyName="E"
            label={translate(language, "radius")}
            ariaLabel={translate(language, "radiusAria")}
            icon={
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
                <circle cx="12" cy="12" r="2.4" />
              </svg>
            }
          />
          <SkillButton
            id="bomb"
            keyName="R"
            label={translate(language, "bomb")}
            ariaLabel={translate(language, "bombAria")}
            icon={
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M19 5l-3 3M5 19l3-3M19 19l-3-3" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            }
          />
        </div>
      </div>

      <div id="ability-feedback" className="hud-ability-feedback" aria-live="polite" />
      <div id="score-effects" className="hud-score-effects" aria-hidden="true" />
      <div id="fps" className="hud-fps" aria-label="实时帧率">
        -- FPS
      </div>
      <div id="drag-pad" className="drag-pad" aria-hidden="true">
        <div id="drag-knob" className="drag-knob" />
      </div>

      {/* Game.ts 仍写入但不单独展示的元素（分数/成长已由排名行与黑洞成长环呈现） */}
      <div className="hud-hidden" aria-hidden="true">
        <span id="score">00000</span>
        <span id="radius">1.15</span>
        <span id="size-level">01</span>
        <span id="growth-copy">36 TO NEXT SIZE</span>
        <div className="growth-track">
          <i id="growth-fill" />
        </div>
      </div>

      <div
        className={`game-exit-toast ${exitToast ? "is-showing" : ""}`}
        role="status"
        aria-live="polite"
      >
        {exitToast}
      </div>
    </main>
  );
}

function RankRow({ index, points }: { index: number; points: string }) {
  return (
    <div id={`rank-${index}`} className="rank-row">
      <span id={`rank-${index}-position`} className="rank-row-position">
        0{index + 1}
      </span>
      <span id={`rank-${index}-avatar`} className="rank-row-avatar" />
      <span className="rank-row-name">
        <b id={`rank-${index}-name`}>YOU</b>
        <small id={`rank-${index}-meta`} className="rank-row-meta">
          Lv.1 · R1.1
        </small>
      </span>
      <span className="rank-row-score">
        <em id={`rank-${index}-score`}>0</em>
        <small>{points}</small>
      </span>
    </div>
  );
}

function SkillButton({
  id,
  keyName,
  label,
  ariaLabel,
  icon,
}: {
  id: "speed" | "radius" | "bomb";
  keyName: string;
  label: string;
  ariaLabel: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      id={`ability-${id}`}
      className={`hud-skill ability-${id}`}
      type="button"
      aria-label={ariaLabel}
    >
      <span className="hud-skill-cd" aria-hidden="true" />
      <span id={`ability-${id}-cooldown`} className="hud-skill-count" />
      <span className="hud-skill-icon">{icon}</span>
      <span className="hud-skill-key">{keyName}</span>
      <span className="hud-skill-label">{label}</span>
      <span id={`ability-${id}-status`} className="hud-skill-status" />
    </button>
  );
}

function OpponentIndicator({ index }: { index: number }) {
  return (
    <div id={`opponent-${index}-indicator`} className="direction-marker" hidden>
      <div className="direction-tag">
        <span className="direction-tag-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <rect x="5" y="7" width="14" height="12" rx="3" />
            <path d="M12 3.4v3.6" />
            <circle cx="12" cy="3" r="1.3" />
            <circle cx="9.5" cy="12" r="1" />
            <circle cx="14.5" cy="12" r="1" />
            <path d="M9.5 16h5" />
          </svg>
        </span>
        <span className="direction-tag-name" id={`opponent-${index}-name`}>
          PLAYER
        </span>
        <span className="direction-tag-distance" id={`opponent-${index}-distance`}>
          0m
        </span>
        <span className="direction-tag-arrow" id={`opponent-${index}-arrow`} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M9 4l9 8-9 8" />
          </svg>
        </span>
      </div>
    </div>
  );
}
