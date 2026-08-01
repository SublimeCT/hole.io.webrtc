import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { PLAYER_NAME_PATTERN } from "@hole-io/shared/protocol";
import { getHoleProgress } from "@hole-io/shared/simulation";

import {
  loadPreferences,
  persistPreferences,
  RENDER_FRAME_RATES,
  type GamePreferences,
  type RenderFrameRate,
} from "../app/preferences";
import {
  applyDocumentLanguage,
  LANGUAGES,
  LANGUAGE_NAMES,
  translate,
  type Language,
} from "../app/i18n";
import { loadPlayerStats } from "../app/playerStats";
import { useMultiplayer } from "../net/MultiplayerProvider";
import { VoidWordmark } from "../ui/VoidWordmark";

const RING_COLORS = [
  "#2bf0ff",
  "#7c5cff",
  "#ff5c8a",
  "#ffd23f",
  "#3ddc97",
  "#ff8a3d",
  "#5aa9e6",
  "#c98ad1",
  "#9ad1c9",
  "#e06b5a",
  "#b8c24d",
  "#f2f2f2",
] as const;

const REPO_URL = "https://github.com/SublimeCT/hole.io.webrtc";

type MenuAction = "start" | "online" | "settings" | "guide" | "about";

type GuideTab = "controls" | "skills" | "items";

interface MenuButton {
  action: MenuAction;
  title: string;
  subtitle: string;
  icon: ReactElement;
}

export function HomePage() {
  const navigate = useNavigate();
  const { disposeSession } = useMultiplayer();
  const [preferences, setPreferences] = useState<GamePreferences>(() => loadPreferences());
  const [stats] = useState(() => loadPlayerStats());
  const bestHoleProgress = getHoleProgress(stats.bestScore);
  // 根据历史最高分（成长等级阈值）授予头衔，作为战绩卡右上角徽章。
  const profileTitleKey =
    stats.bestScore >= 1800
      ? "titleAbyss"
      : stats.bestScore >= 720
        ? "titleCity"
        : stats.bestScore >= 234
          ? "titleBlock"
          : stats.bestScore >= 36
            ? "titleStreet"
            : "titleNew";
  const [draftName, setDraftName] = useState(preferences.playerName);
  const [draftColor, setDraftColor] = useState(preferences.playerRingColor);
  const [draftLanguage, setDraftLanguage] = useState<Language>(preferences.language);
  const [draftRenderFrameRate, setDraftRenderFrameRate] = useState<RenderFrameRate>(
    preferences.renderFrameRate,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [guideTab, setGuideTab] = useState<GuideTab>("controls");
  const [focusedMenu, setFocusedMenu] = useState(0);

  const menuButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const nameInput = useRef<HTMLInputElement>(null);
  const guideCloseBtn = useRef<HTMLButtonElement>(null);
  const aboutCloseBtn = useRef<HTMLButtonElement>(null);
  const miniLayer = useRef<HTMLDivElement>(null);
  const holeScene = useRef<HTMLDivElement>(null);
  const starsLayer = useRef<HTMLDivElement>(null);

  const buttons: readonly MenuButton[] = [
    {
      action: "start",
      title: translate(preferences.language, "start"),
      subtitle: translate(preferences.language, "startSub"),
      icon: (
        <svg viewBox="0 0 24 24">
          <path d="M7 4l13 8-13 8z" />
        </svg>
      ),
    },
    {
      action: "online",
      title: translate(preferences.language, "online"),
      subtitle: translate(preferences.language, "onlineSub"),
      icon: (
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </svg>
      ),
    },
    {
      action: "settings",
      title: translate(preferences.language, "settings"),
      subtitle: translate(preferences.language, "settingsSub"),
      icon: (
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3.2" />
          <path d="M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 2h-5l-.3 2.5a7 7 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.3 2.5h5l.3-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6a7 7 0 0 0 .1-1z" />
        </svg>
      ),
    },
    {
      action: "guide",
      title: translate(preferences.language, "guide"),
      subtitle: translate(preferences.language, "guideSub"),
      icon: (
        <svg viewBox="0 0 24 24">
          <path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v17H7.5A3.5 3.5 0 0 0 4 22zM20 5.5A3.5 3.5 0 0 0 16.5 2H13v17h3.5a3.5 3.5 0 0 1 3.5 3z" />
        </svg>
      ),
    },
    {
      action: "about",
      title: translate(preferences.language, "about"),
      subtitle: translate(preferences.language, "aboutSub"),
      icon: (
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 10v6M12 7h.01" />
        </svg>
      ),
    },
  ];

  useEffect(() => {
    menuButtons.current[focusedMenu]?.focus();
  }, [focusedMenu]);

  useEffect(() => {
    if (settingsOpen) nameInput.current?.focus();
  }, [settingsOpen]);

  useEffect(() => {
    if (guideOpen) guideCloseBtn.current?.focus();
  }, [guideOpen]);

  useEffect(() => {
    if (aboutOpen) aboutCloseBtn.current?.focus();
  }, [aboutOpen]);

  // 粒子（向右漂移，与网格节奏一致）
  useEffect(() => {
    const stars = starsLayer.current;
    if (!stars) return;
    const nodes: HTMLElement[] = [];
    for (let i = 0; i < 70; i += 1) {
      const s = document.createElement("div");
      s.className = "home-star";
      const size = Math.random() * 2.5 + 2;
      s.style.width = `${size}px`;
      s.style.height = `${size}px`;
      s.style.left = `${Math.random() * 100}%`;
      s.style.top = `${Math.random() * 100}%`;
      if (i % 5 === 0) s.style.background = "var(--accent)";
      else if (i % 7 === 0) s.style.background = "var(--accent-2)";
      s.style.setProperty("--star-twinkle", `${Math.random() * 2.4 + 1.6}s`);
      s.style.setProperty("--star-drift", `${Math.random() * 6 + 5}s`);
      s.style.animationDelay = `${-Math.random() * 6}s`;
      stars.append(s);
      nodes.push(s);
    }
    return () => {
      nodes.forEach((n) => n.remove());
    };
  }, []);

  // 被吞噬的小黑洞：1/2 与 1/3 主洞尺寸，同速（一致时长）从左侧飞向主洞。
  // 不缩小——到达中心时淡出表示“被吞噬”。
  // 每次吞噬：持久累加 --feed-scale（主洞“略微变大”，transition 使其平滑）；
  // 显示固定击杀浮字（+300 / +200）。
  useEffect(() => {
    const layer = miniLayer.current;
    const scene = holeScene.current;
    if (!layer || !scene) return;
    const DURATION = 8; // 两洞同速
    const configs = [
      { size: "50%", y: "-9vh", delay: -0.8, glow: "is-cyan", score: "+300" },
      { size: "33%", y: "9vh", delay: -3.2, glow: "is-amber", score: "+200" },
    ];
    let feedScale = 1;
    const MAX_FEED = 1.4;
    const onSwallow = (score: string) => {
      feedScale = Math.min(MAX_FEED, feedScale + 0.03);
      scene.style.setProperty("--feed-scale", feedScale.toString());
      const pop = document.createElement("span");
      pop.className = "home-kill-pop";
      pop.textContent = score;
      pop.addEventListener("animationend", () => pop.remove(), { once: true });
      scene.append(pop);
    };
    const created: HTMLElement[] = [];
    configs.forEach((config) => {
      const hole = document.createElement("div");
      hole.className = `home-mini-hole ${config.glow}`;
      hole.style.setProperty("--mini-size", config.size);
      hole.style.setProperty("--mini-duration", `${DURATION}s`);
      hole.style.setProperty("--mini-y", config.y);
      hole.style.animationDelay = `${config.delay}s`;
      const glow = document.createElement("div");
      glow.className = "home-mini-glow";
      const core = document.createElement("div");
      core.className = "home-mini-core";
      hole.append(glow, core);
      hole.addEventListener("animationiteration", () => onSwallow(config.score));
      layer.append(hole);
      created.push(hole);
    });
    return () => {
      created.forEach((node) => node.remove());
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey) return;
      if (settingsOpen) {
        if (event.code === "Escape") {
          event.preventDefault();
          setSettingsOpen(false);
          menuButtons.current[2]?.focus(); // 设置按钮
        }
        return;
      }
      if (guideOpen) {
        if (event.code === "Escape") {
          event.preventDefault();
          setGuideOpen(false);
          menuButtons.current[3]?.focus(); // 玩法介绍按钮
        }
        return;
      }
      if (aboutOpen) {
        if (event.code === "Escape") {
          event.preventDefault();
          setAboutOpen(false);
          menuButtons.current[4]?.focus(); // 关于按钮
        }
        return;
      }
      if (
        event.code === "ArrowUp" ||
        event.code === "ArrowDown" ||
        event.code === "ArrowLeft" ||
        event.code === "ArrowRight"
      ) {
        event.preventDefault();
        const offset = event.code === "ArrowUp" || event.code === "ArrowLeft" ? -1 : 1;
        setFocusedMenu((current) => (current + offset + buttons.length) % buttons.length);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [buttons.length, settingsOpen, guideOpen, aboutOpen]);

  const triggerAction = async (action: MenuAction): Promise<void> => {
    switch (action) {
      case "start":
        navigate("/game");
        return;
      case "online":
        // 主页联机 = 新会话：清掉可能残留的旧房间 session（玩家未点离开、经浏览器后退回主页等），
        // 避免再次进入联机时复用旧房间。
        disposeSession();
        navigate({ pathname: "/online", search: "" });
        return;
      case "settings":
        setDraftName(preferences.playerName);
        setDraftColor(preferences.playerRingColor);
        setDraftLanguage(preferences.language);
        setDraftRenderFrameRate(preferences.renderFrameRate);
        setSettingsOpen(true);
        return;
      case "guide":
        setGuideTab("controls");
        setGuideOpen(true);
        return;
      case "about":
        setAboutOpen(true);
        return;
    }
  };

  const submitSettings = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const playerName = draftName.normalize("NFKC").trim();
    const playerNameLength = Array.from(playerName).length;
    if (playerNameLength < 2 || playerNameLength > 10 || !PLAYER_NAME_PATTERN.test(playerName)) {
      nameInput.current?.setCustomValidity(translate(preferences.language, "nameInvalid"));
      nameInput.current?.reportValidity();
      return;
    }
    nameInput.current?.setCustomValidity("");
    const nextPreferences: GamePreferences = {
      playerName,
      playerRingColor: draftColor,
      language: draftLanguage,
      renderFrameRate: draftRenderFrameRate,
    };
    setPreferences(nextPreferences);
    persistPreferences(nextPreferences);
    applyDocumentLanguage(draftLanguage);
    setSettingsOpen(false);
    menuButtons.current[2]?.focus(); // 设置按钮
  };

  return (
    <main className="home">
      <div className="home-bg" aria-hidden="true">
        <div className="home-bg-grid" />
        <div className="home-stars" ref={starsLayer} />
        <div className="home-hole-scene" ref={holeScene}>
          <div className="home-hole-glow" />
          <div className="home-hole-ring" />
          <div className="home-hole-core" />
          <div className="home-mini-layer" ref={miniLayer} />
        </div>
        <div className="home-bg-fade" />
      </div>

      <div className="home-wrap">
        <header className="home-topbar">
          <div className="home-brand">
            <img
              className="home-brand-mark"
              src={`${import.meta.env.BASE_URL}void-mark.svg?v=5`}
              alt=""
              aria-hidden="true"
            />
            <div className="home-brand-name">VOID</div>
          </div>
          <div className="home-top-actions">
            <a
              className="home-gh-btn"
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={translate(preferences.language, "github")}
              title={translate(preferences.language, "github")}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 1C5.92 1 1 5.92 1 12c0 4.86 3.15 8.98 7.52 10.44.55.1.75-.24.75-.53 0-.26-.01-.95-.02-1.86-3.06.66-3.71-1.48-3.71-1.48-.5-1.27-1.22-1.61-1.22-1.61-1-.68.08-.67.08-.67 1.1.08 1.68 1.13 1.68 1.13.98 1.68 2.57 1.2 3.2.92.1-.71.38-1.2.69-1.48-2.44-.28-5.01-1.22-5.01-5.43 0-1.2.43-2.18 1.13-2.95-.11-.28-.49-1.4.11-2.92 0 0 .92-.3 3.02 1.13a10.5 10.5 0 0 1 5.5 0c2.1-1.43 3.02-1.13 3.02-1.13.6 1.52.22 2.64.11 2.92.7.77 1.13 1.75 1.13 2.95 0 4.22-2.57 5.15-5.02 5.42.39.34.74 1.01.74 2.04 0 1.47-.01 2.66-.01 3.02 0 .29.2.64.76.53A11 11 0 0 0 23 12c0-6.08-4.92-11-11-11z" />
              </svg>
              <span className="home-gh-label">GitHub</span>
            </a>
          </div>
        </header>

        <section className="home-main">
          <span className="home-kicker">{translate(preferences.language, "kicker")}</span>
          <h1 className="home-title">
            <VoidWordmark />
          </h1>
          <p className="home-tagline">{translate(preferences.language, "tagline")}</p>
          <nav className="home-menu" aria-label={translate(preferences.language, "menu")}>
            {buttons.map((button, index) => (
              <button
                key={button.action}
                ref={(element) => {
                  menuButtons.current[index] = element;
                }}
                className={`home-mbtn ${focusedMenu === index ? "is-focused" : ""}`}
                type="button"
                onFocus={() => setFocusedMenu(index)}
                onClick={() => void triggerAction(button.action)}
              >
                <span className="home-mbtn-icon">{button.icon}</span>
                <span className="home-mbtn-text">
                  <span className="home-mbtn-title">{button.title}</span>
                  <span className="home-mbtn-sub">{button.subtitle}</span>
                </span>
                <span className="home-mbtn-enter">
                  {translate(preferences.language, "press")}{" "}
                  <kbd className="home-mbtn-key">Enter</kbd>
                </span>
              </button>
            ))}
          </nav>
        </section>

        <aside className="home-livecard" aria-label={translate(preferences.language, "profile")}>
          <div className="home-lc-head">
            <span className="home-lc-title">{translate(preferences.language, "profile")}</span>
            <span className="home-lc-badge">
              {translate(preferences.language, profileTitleKey)}
            </span>
          </div>
          <div className="home-lc-row">
            <span className="home-lc-label">{translate(preferences.language, "bestSize")}</span>
            <span className="home-lc-value home-lc-value-gold">
              Lv.{bestHoleProgress.level + 1}
              <small>· {bestHoleProgress.radius.toFixed(1)}m</small>
            </span>
          </div>
          <div className="home-lc-row">
            <span className="home-lc-label">
              {translate(preferences.language, "lifetimeSwallowed")}
            </span>
            <span className="home-lc-value home-lc-value-accent">
              {stats.totalSwallowed.toLocaleString()}
            </span>
          </div>
          <div className="home-lc-row">
            <span className="home-lc-label">{translate(preferences.language, "gamesPlayed")}</span>
            <span className="home-lc-value">{stats.gamesPlayed.toLocaleString()}</span>
          </div>
          <div className="home-lc-spark" aria-hidden="true">
            {Array.from({ length: 9 }, (_, index) => (
              <i key={index} />
            ))}
          </div>
        </aside>
      </div>

      {settingsOpen && (
        <div
          className="home-modal"
          role="dialog"
          aria-label={translate(preferences.language, "settings")}
          onClick={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
          <form className="home-modal-sheet" onSubmit={submitSettings}>
            <div className="home-modal-head">
              <div className="home-modal-head-title">
                <span className="home-modal-head-eyebrow">
                  VOID / {translate(preferences.language, "settings")}
                </span>
                <h2>{translate(preferences.language, "settings")}</h2>
              </div>
              <button
                className="home-modal-close"
                type="button"
                aria-label={translate(preferences.language, "close")}
                onClick={() => setSettingsOpen(false)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div className="home-field">
              <label className="home-field-label" htmlFor="player-name">
                {translate(preferences.language, "playerName")}
              </label>
              <input
                ref={nameInput}
                id="player-name"
                className="home-field-input"
                type="text"
                minLength={2}
                maxLength={10}
                defaultValue={draftName}
                autoComplete="nickname"
                required
                onChange={(event) => {
                  event.currentTarget.setCustomValidity("");
                  setDraftName(event.currentTarget.value);
                }}
              />
              <div className="home-field-hint">
                {translate(preferences.language, "playerNameHint")}
              </div>
            </div>
            <div className="home-field">
              <label className="home-field-label" htmlFor="interface-language">
                {translate(preferences.language, "language")}
              </label>
              <select
                id="interface-language"
                className="home-field-input"
                value={draftLanguage}
                onChange={(event) => setDraftLanguage(event.currentTarget.value as Language)}
              >
                {LANGUAGES.map((language) => (
                  <option key={language} value={language}>
                    {LANGUAGE_NAMES[language]}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="home-field home-fieldset">
              <legend className="home-field-label">
                {translate(preferences.language, "frameRate")}
              </legend>
              <div className="home-segmented">
                {RENDER_FRAME_RATES.map((frameRate) => (
                  <label
                    key={frameRate}
                    className={`home-segment ${draftRenderFrameRate === frameRate ? "is-on" : ""}`}
                  >
                    <input
                      type="radio"
                      name="render-frame-rate"
                      value={frameRate}
                      checked={draftRenderFrameRate === frameRate}
                      onChange={() => setDraftRenderFrameRate(frameRate)}
                    />
                    <span>{frameRate} fps</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="home-field">
              <label className="home-field-label">
                {translate(preferences.language, "ringColor")}
              </label>
              <div className="home-swatches">
                {RING_COLORS.map((color) => (
                  <button
                    key={color}
                    className={`home-swatch ${draftColor === color ? "is-on" : ""}`}
                    type="button"
                    aria-label={translate(preferences.language, "ringColorAria", { color })}
                    aria-pressed={draftColor === color}
                    style={{ background: color }}
                    onClick={() => setDraftColor(color)}
                  />
                ))}
              </div>
            </div>
            <div className="home-modal-actions">
              <button className="home-btn" type="button" onClick={() => setSettingsOpen(false)}>
                {translate(preferences.language, "cancel")} (Esc)
              </button>
              <button className="home-btn home-btn-primary" type="submit">
                {translate(preferences.language, "save")} (Enter)
              </button>
            </div>
          </form>
        </div>
      )}

      {guideOpen && (
        <div
          className="home-modal"
          role="dialog"
          aria-modal="true"
          aria-label={translate(preferences.language, "guide")}
          onClick={(event) => {
            if (event.target === event.currentTarget) setGuideOpen(false);
          }}
        >
          <div className="home-modal-sheet home-guide-sheet">
            <div className="home-modal-head">
              <div className="home-modal-head-title">
                <span className="home-modal-head-eyebrow">
                  VOID / {translate(preferences.language, "guide")}
                </span>
                <h2>{translate(preferences.language, "guide")}</h2>
              </div>
              <button
                ref={guideCloseBtn}
                className="home-modal-close"
                type="button"
                aria-label={translate(preferences.language, "close")}
                onClick={() => setGuideOpen(false)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div
              className="home-guide-tabs"
              role="tablist"
              aria-label={translate(preferences.language, "guide")}
            >
              {(["controls", "skills", "items"] as const).map((tab) => {
                const label =
                  tab === "controls"
                    ? translate(preferences.language, "guideTabControls")
                    : tab === "skills"
                      ? translate(preferences.language, "guideTabSkills")
                      : translate(preferences.language, "guideTabItems");
                return (
                  <button
                    key={tab}
                    className={`home-guide-tab ${guideTab === tab ? "is-on" : ""}`}
                    role="tab"
                    aria-selected={guideTab === tab}
                    type="button"
                    onClick={() => setGuideTab(tab)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="home-guide-body">
              {guideTab === "controls" && (
                <div className="home-control-grid">
                  <article className="home-control-card">
                    <h3>
                      {translate(preferences.language, "guidePcTitle")}
                      <span>{translate(preferences.language, "guidePcBadge")}</span>
                    </h3>
                    <div className="home-guide-row">
                      <b>{translate(preferences.language, "guideMove")}</b>
                      <div className="home-keyset">
                        <kbd>W</kbd>
                        <kbd>A</kbd>
                        <kbd>S</kbd>
                        <kbd>D</kbd>
                      </div>
                    </div>
                    <div className="home-guide-row">
                      <b>{translate(preferences.language, "guideAbility")}</b>
                      <div className="home-keyset">
                        <kbd>Q</kbd>
                        <kbd>E</kbd>
                        <kbd>R</kbd>
                      </div>
                    </div>
                    <div className="home-guide-row">
                      <b>{translate(preferences.language, "guideMethod")}</b>
                      <span>{translate(preferences.language, "guidePcMethod")}</span>
                    </div>
                  </article>
                  <article className="home-control-card">
                    <h3>
                      {translate(preferences.language, "guideMobileTitle")}
                      <span>{translate(preferences.language, "guideMobileBadge")}</span>
                    </h3>
                    <div className="home-touch-zone" aria-hidden="true">
                      <span className="home-touch-zone-label">
                        {translate(preferences.language, "guideTouchZone")}
                      </span>
                    </div>
                    <div className="home-guide-row">
                      <b>{translate(preferences.language, "guideMove")}</b>
                      <span>{translate(preferences.language, "guideMobileMoveDesc")}</span>
                    </div>
                    <div className="home-guide-row">
                      <b>{translate(preferences.language, "guideAbility")}</b>
                      <span>{translate(preferences.language, "guideMobileAbilityDesc")}</span>
                    </div>
                  </article>
                </div>
              )}
              {guideTab === "skills" && (
                <div className="home-skill-list">
                  <article className="home-guide-skill">
                    <span className="home-guide-skill-key">Q</span>
                    <span className="home-guide-skill-meta">
                      <b>{translate(preferences.language, "guideSec", { n: 5 })}</b>
                      {translate(preferences.language, "guideCooldown", { n: 15 })}
                    </span>
                    <h3>{translate(preferences.language, "guideSkillQ")}</h3>
                    <p>{translate(preferences.language, "guideSkillQDesc")}</p>
                  </article>
                  <article className="home-guide-skill">
                    <span className="home-guide-skill-key">E</span>
                    <span className="home-guide-skill-meta">
                      <b>{translate(preferences.language, "guideImmediate")}</b>
                      {translate(preferences.language, "guideCooldown", { n: 25 })}
                    </span>
                    <h3>{translate(preferences.language, "guideSkillE")}</h3>
                    <p>{translate(preferences.language, "guideSkillEDesc")}</p>
                  </article>
                  <article className="home-guide-skill home-guide-skill-danger">
                    <span className="home-guide-skill-key">R</span>
                    <span className="home-guide-skill-meta">
                      <b>{translate(preferences.language, "guideFuse", { n: 3 })}</b>
                      {translate(preferences.language, "guideCooldown", { n: 45 })}
                    </span>
                    <h3>{translate(preferences.language, "guideSkillR")}</h3>
                    <p>{translate(preferences.language, "guideSkillRDesc")}</p>
                  </article>
                </div>
              )}
              {guideTab === "items" && (
                <div className="home-item-list">
                  <article className="home-guide-item">
                    <span className="home-guide-item-emoji" aria-hidden="true">
                      🧲
                    </span>
                    <div>
                      <h3>{translate(preferences.language, "guideItemMagnet")}</h3>
                      <p>{translate(preferences.language, "guideItemMagnetDesc")}</p>
                    </div>
                  </article>
                  <article className="home-guide-item">
                    <span className="home-guide-item-emoji" aria-hidden="true">
                      🔍
                    </span>
                    <div>
                      <h3>{translate(preferences.language, "guideItemShrink")}</h3>
                      <p>{translate(preferences.language, "guideItemShrinkDesc")}</p>
                    </div>
                  </article>
                  <article className="home-guide-item">
                    <span className="home-guide-item-emoji" aria-hidden="true">
                      🦶
                    </span>
                    <div>
                      <h3>{translate(preferences.language, "guideItemFootprint")}</h3>
                      <p>{translate(preferences.language, "guideItemFootprintDesc")}</p>
                    </div>
                  </article>
                  <article className="home-guide-item">
                    <span className="home-guide-item-emoji" aria-hidden="true">
                      🍔
                    </span>
                    <div>
                      <h3>{translate(preferences.language, "guideItemBurger")}</h3>
                      <p>{translate(preferences.language, "guideItemBurgerDesc")}</p>
                    </div>
                  </article>
                  <article className="home-guide-item">
                    <span className="home-guide-item-emoji" aria-hidden="true">
                      💩
                    </span>
                    <div>
                      <h3>{translate(preferences.language, "guideItemPoop")}</h3>
                      <p>{translate(preferences.language, "guideItemPoopDesc")}</p>
                    </div>
                  </article>
                  <article className="home-guide-item">
                    <span className="home-guide-item-emoji" aria-hidden="true">
                      👣
                    </span>
                    <div>
                      <h3>{translate(preferences.language, "guideItemDoubleFootprint")}</h3>
                      <p>{translate(preferences.language, "guideItemDoubleFootprintDesc")}</p>
                    </div>
                  </article>
                  <article className="home-guide-item home-guide-item-wide">
                    <span className="home-guide-item-emoji" aria-hidden="true">
                      🍺
                    </span>
                    <div>
                      <h3>{translate(preferences.language, "guideItemBeer")}</h3>
                      <p>{translate(preferences.language, "guideItemBeerDesc")}</p>
                    </div>
                  </article>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {aboutOpen && (
        <div
          className="home-modal"
          role="dialog"
          aria-modal="true"
          aria-label={translate(preferences.language, "about")}
          onClick={(event) => {
            if (event.target === event.currentTarget) setAboutOpen(false);
          }}
        >
          <div className="home-modal-sheet home-about-sheet">
            <div className="home-modal-head">
              <div className="home-modal-head-title">
                <span className="home-modal-head-eyebrow">
                  VOID / {translate(preferences.language, "about")}
                </span>
                <h2>{translate(preferences.language, "about")}</h2>
              </div>
              <button
                ref={aboutCloseBtn}
                className="home-modal-close"
                type="button"
                aria-label={translate(preferences.language, "close")}
                onClick={() => setAboutOpen(false)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div className="home-about-body">
              <div className="home-about-intro">
                <p>{translate(preferences.language, "aboutIntro")}</p>
                <span className="home-about-vibe">VIBE CODING</span>
              </div>
              <section className="home-about-section">
                <h3>{translate(preferences.language, "aboutLinks")}</h3>
                <div className="home-about-links">
                  <a
                    className="home-about-link home-about-link-wide"
                    href={REPO_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="home-about-logo">GH</span>
                    <span className="home-about-copy">
                      <b>{translate(preferences.language, "aboutRepo")}</b>
                      <small>github.com/SublimeCT/hole.io.webrtc</small>
                    </span>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M14 5h5v5M19 5l-9 9M19 14v5H5V5h5" />
                    </svg>
                  </a>
                  <a
                    className="home-about-link home-about-link-wide"
                    href="https://blog.xiaban.run/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="home-about-logo">XB</span>
                    <span className="home-about-copy">
                      <b>{translate(preferences.language, "aboutBlog")}</b>
                      <small>blog.xiaban.run</small>
                    </span>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M14 5h5v5M19 5l-9 9M19 14v5H5V5h5" />
                    </svg>
                  </a>
                </div>
              </section>
              <section className="home-about-section">
                <h3>{translate(preferences.language, "aboutTech")}</h3>
                <div className="home-about-links">
                  <a
                    className="home-about-link"
                    href="https://react.dev/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="home-about-logo">R</span>
                    <span className="home-about-copy">
                      <b>React</b>
                      <small>{translate(preferences.language, "aboutReactDesc")}</small>
                    </span>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M14 5h5v5M19 5l-9 9M19 14v5H5V5h5" />
                    </svg>
                  </a>
                  <a
                    className="home-about-link"
                    href="https://threejs.org/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="home-about-logo">3D</span>
                    <span className="home-about-copy">
                      <b>three.js</b>
                      <small>{translate(preferences.language, "aboutThreeDesc")}</small>
                    </span>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M14 5h5v5M19 5l-9 9M19 14v5H5V5h5" />
                    </svg>
                  </a>
                  <a
                    className="home-about-link"
                    href="https://webrtc.org/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="home-about-logo">RTC</span>
                    <span className="home-about-copy">
                      <b>WebRTC</b>
                      <small>{translate(preferences.language, "aboutWebRTCDesc")}</small>
                    </span>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M14 5h5v5M19 5l-9 9M19 14v5H5V5h5" />
                    </svg>
                  </a>
                  <a
                    className="home-about-link"
                    href="https://kenney.nl/assets"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="home-about-logo">K</span>
                    <span className="home-about-copy">
                      <b>Kenney</b>
                      <small>{translate(preferences.language, "aboutKenneyDesc")}</small>
                    </span>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M14 5h5v5M19 5l-9 9M19 14v5H5V5h5" />
                    </svg>
                  </a>
                </div>
              </section>
              <section className="home-about-section">
                <h3>{translate(preferences.language, "aboutLLM")}</h3>
                <div className="home-about-links">
                  <a
                    className="home-about-link"
                    href="https://openai.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="home-about-logo">AI</span>
                    <span className="home-about-copy">
                      <b>ChatGPT</b>
                      <small>{translate(preferences.language, "aboutChatGPTDesc")}</small>
                    </span>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M14 5h5v5M19 5l-9 9M19 14v5H5V5h5" />
                    </svg>
                  </a>
                  <a
                    className="home-about-link"
                    href="https://bigmodel.cn/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="home-about-logo">GLM</span>
                    <span className="home-about-copy">
                      <b>glm-5.2</b>
                      <small>{translate(preferences.language, "aboutGLMDesc")}</small>
                    </span>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M14 5h5v5M19 5l-9 9M19 14v5H5V5h5" />
                    </svg>
                  </a>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
