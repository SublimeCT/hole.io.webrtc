import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

import { saveMatchResult } from "../app/matchResult";
import { loadPreferences } from "../app/preferences";
import { Game, type AbilityButtonUi, type GameUi } from "../game/Game";

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
    rankingRows: [
      {
        root: requireElement("#rank-first"),
        position: requireElement("#rank-first-position"),
        name: requireElement("#rank-first-name"),
        score: requireElement("#rank-first-score"),
      },
      {
        root: requireElement("#rank-second"),
        position: requireElement("#rank-second-position"),
        name: requireElement("#rank-second-name"),
        score: requireElement("#rank-second-score"),
      },
      {
        root: requireElement("#rank-third"),
        position: requireElement("#rank-third-position"),
        name: requireElement("#rank-third-name"),
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
  };
}

export default function GamePage() {
  const navigate = useNavigate();
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const gameCanvas = canvas.current;
    if (!gameCanvas) return;
    let disposed = false;
    let game: Game | null = null;

    void Game.create(gameCanvas, collectGameUi(), loadPreferences(), (result) => {
      saveMatchResult(result);
      navigate("/results", { replace: true });
    })
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
        if (status) status.textContent = "LOAD ERROR";
        console.error(error);
      });

    return () => {
      disposed = true;
      game?.dispose();
    };
  }, [navigate]);

  return (
    <main className="app-shell">
      <canvas ref={canvas} className="game-canvas" aria-label="Hole City 游戏场景" />
      <div className="screen-texture" aria-hidden="true" />

      <div id="loading" className="loading" role="status" aria-live="polite">
        <div className="loading-content">
          <span className="kicker">CONNECTING DISTRICT</span>
          <strong>HOLE CITY</strong>
          <div className="loading-track">
            <i id="loading-bar" />
          </div>
          <span id="loading-status" className="loading-status">
            00 / 00
          </span>
        </div>
      </div>

      <header className="hud match-hud" aria-label="游戏状态">
        <div className="match-bar">
          <button
            className="home-command"
            type="button"
            aria-label="返回主页"
            onClick={() => navigate("/")}
          >
            <span>主页</span>
          </button>
          <section className="score-readout">
            <span className="panel-label">SCORE</span>
            <strong id="score">00000</strong>
            <small>YOU</small>
          </section>
          <section className="time-readout">
            <span>TIME LEFT</span>
            <strong id="time">3:00</strong>
          </section>
          <section className="ranking-panel" aria-label="实时排名">
            <span className="panel-label">LIVE RANKING</span>
            <ol>
              <li id="rank-first" className="rank-row">
                <span id="rank-first-position">01</span>
                <i />
                <b id="rank-first-name">YOU</b>
                <small>RANK</small>
                <em id="rank-first-score">00000</em>
              </li>
              <li id="rank-second" className="rank-row">
                <span id="rank-second-position">02</span>
                <i />
                <b id="rank-second-name">BOT 01</b>
                <small>RANK</small>
                <em id="rank-second-score">00000</em>
              </li>
              <li id="rank-third" className="rank-row">
                <span id="rank-third-position">03</span>
                <i />
                <b id="rank-third-name">BOT 02</b>
                <small>RANK</small>
                <em id="rank-third-score">00000</em>
              </li>
            </ol>
          </section>
        </div>
      </header>

      <section className="player-state growth-module" aria-label="黑洞成长进度">
        <span>
          SIZE <b id="size-level">01</b>
        </span>
        <span id="growth-copy">36 TO NEXT SIZE</span>
        <span>
          R <b id="radius">1.15</b>
        </span>
        <div className="growth-track">
          <i id="growth-fill" />
        </div>
      </section>

      <section className="ability-bar" aria-label="技能">
        <AbilityButton id="speed" label="移速提升，快捷键 Q" icon="🚀" title="Q · BOOST" />
        <AbilityButton id="radius" label="直接升级，快捷键 E" icon="🌪️" title="E · VORTEX" />
        <AbilityButton id="bomb" label="自爆炸弹，快捷键 R" icon="💣" title="R · BOMB" />
      </section>
      <div id="ability-feedback" className="ability-feedback" aria-live="polite" />
      <div id="score-effects" className="score-effects" aria-hidden="true" />

      <div className="direction-layer opponent-indicators" aria-hidden="true">
        <OpponentIndicator id="bot-one" label="BOT 01" />
        <OpponentIndicator id="bot-two" label="BOT 02" />
      </div>
      <div id="drag-pad" className="drag-pad" aria-hidden="true">
        <div id="drag-knob" className="drag-knob" />
      </div>
    </main>
  );
}

function AbilityButton({
  id,
  label,
  icon,
  title,
}: {
  id: "speed" | "radius" | "bomb";
  label: string;
  icon: string;
  title: string;
}) {
  return (
    <button
      id={`ability-${id}`}
      className={`ability-button ability-${id}`}
      type="button"
      aria-label={label}
    >
      <b className="ability-icon" aria-hidden="true">
        {icon}
      </b>
      <span className="ability-copy">
        <strong>{title}</strong>
        <small id={`ability-${id}-status`}>READY</small>
      </span>
      <em id={`ability-${id}-cooldown`} />
    </button>
  );
}

function OpponentIndicator({ id, label }: { id: "bot-one" | "bot-two"; label: string }) {
  return (
    <div id={`${id}-indicator`} className={`direction-marker ${id}-indicator`}>
      <svg id={`${id}-arrow`} className="direction-arrow" viewBox="0 0 64 64" aria-hidden="true">
        <path d="M19 48a13 13 0 0 1 26 0" />
        <path d="M32 54V18" />
        <path d="m18 31 14-14 14 14" />
      </svg>
      <span className="direction-label">
        <i />
        <b>{label}</b>
        <small id={`${id}-distance`}>0m</small>
      </span>
    </div>
  );
}
