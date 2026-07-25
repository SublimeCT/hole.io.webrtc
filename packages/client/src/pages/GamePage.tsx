import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { saveMatchResult } from "../app/matchResult";
import { loadPreferences } from "../app/preferences";
import { translate } from "../app/i18n";
import { Game, type AbilityButtonUi, type GameUi } from "../game/Game";
import { VoidWordmark } from "../ui/VoidWordmark";

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

function collectGameUi(): GameUi {
  return {
    score: requireElement("#score"),
    radius: requireElement("#radius"),
    sizeLevel: requireElement("#size-level"),
    growthCopy: requireElement("#growth-copy"),
    growthFill: requireElement("#growth-fill"),
    time: requireElement("#time"),
    timerRoot: requireElement("#timer-root"),
    rankingRows: [
      {
        root: requireElement("#rank-first"),
        position: requireElement("#rank-first-position"),
        avatar: requireElement("#rank-first-avatar"),
        name: requireElement("#rank-first-name"),
        meta: requireElement("#rank-first-meta"),
        score: requireElement("#rank-first-score"),
      },
      {
        root: requireElement("#rank-second"),
        position: requireElement("#rank-second-position"),
        avatar: requireElement("#rank-second-avatar"),
        name: requireElement("#rank-second-name"),
        meta: requireElement("#rank-second-meta"),
        score: requireElement("#rank-second-score"),
      },
      {
        root: requireElement("#rank-third"),
        position: requireElement("#rank-third-position"),
        avatar: requireElement("#rank-third-avatar"),
        name: requireElement("#rank-third-name"),
        meta: requireElement("#rank-third-meta"),
        score: requireElement("#rank-third-score"),
      },
    ],
    dragPad: requireElement("#drag-pad"),
    dragKnob: requireElement("#drag-knob"),
    loading: requireElement("#loading"),
    loadingBar: requireElement("#loading-bar"),
    loadingStatus: requireElement("#loading-status"),
    scoreEffects: requireElement("#score-effects"),
    opponentIndicators: [
      {
        root: requireElement("#bot-one-indicator"),
        arrow: requireElement("#bot-one-arrow"),
        distance: requireElement("#bot-one-distance"),
      },
      {
        root: requireElement("#bot-two-indicator"),
        arrow: requireElement("#bot-two-arrow"),
        distance: requireElement("#bot-two-distance"),
      },
    ],
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

  useEffect(() => {
    const gameCanvas = canvas.current;
    if (!gameCanvas) return;
    let disposed = false;
    let game: Game | null = null;

    void Game.create(
      gameCanvas,
      collectGameUi(),
      preferences,
      (result) => {
        saveMatchResult(result);
        navigate("/results", { replace: true });
      },
      (playerCount) => {
        setPoopRain(
          Array.from({ length: playerCount * 10 }, (_, id) => ({
            id,
            size: 60 + Math.random() * 120,
            left: Math.random() * 100,
            delay: Math.random() * 0.9,
          })),
        );
        window.setTimeout(() => setPoopRain([]), 3_000);
      },
    )
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

    return () => {
      disposed = true;
      game?.dispose();
    };
  }, [language, navigate]);

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
          onClick={() => navigate("/")}
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
          <RankRow id="first" points={translate(language, "points")} />
          <RankRow id="second" points={translate(language, "points")} />
          <RankRow id="third" points={translate(language, "points")} />
        </section>
      </header>

      <div className="hud-arrows" aria-hidden="true">
        <OpponentIndicator id="bot-one" name="BOT 01" />
        <OpponentIndicator id="bot-two" name="BOT 02" />
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
    </main>
  );
}

function RankRow({ id, points }: { id: "first" | "second" | "third"; points: string }) {
  return (
    <div id={`rank-${id}`} className="rank-row">
      <span id={`rank-${id}-position`} className="rank-row-position">
        0{id === "first" ? 1 : id === "second" ? 2 : 3}
      </span>
      <span id={`rank-${id}-avatar`} className="rank-row-avatar" />
      <span className="rank-row-name">
        <b id={`rank-${id}-name`}>YOU</b>
        <small id={`rank-${id}-meta`} className="rank-row-meta">
          Lv.1 · R1.1
        </small>
      </span>
      <span className="rank-row-score">
        <em id={`rank-${id}-score`}>0</em>
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

function OpponentIndicator({ id, name }: { id: "bot-one" | "bot-two"; name: string }) {
  return (
    <div id={`${id}-indicator`} className={`direction-marker ${id}-indicator`}>
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
        <span className="direction-tag-name">{name}</span>
        <span className="direction-tag-distance" id={`${id}-distance`}>
          0m
        </span>
        <span className="direction-tag-arrow" id={`${id}-arrow`} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M9 4l9 8-9 8" />
          </svg>
        </span>
      </div>
    </div>
  );
}
