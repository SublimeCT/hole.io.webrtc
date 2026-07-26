import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { PLAYER_NAME_PATTERN } from "@hole-io/shared/protocol";

import { loadPreferences, persistPreferences, type GamePreferences } from "../app/preferences";
import {
  applyDocumentLanguage,
  LANGUAGES,
  LANGUAGE_NAMES,
  translate,
  type Language,
} from "../app/i18n";
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

type MenuAction = "start" | "settings" | "share" | "online";

interface MenuButton {
  action: MenuAction;
  title: string;
  subtitle: string;
  icon: ReactElement;
}

async function copyGameLink(url: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
    return;
  }
  const input = document.createElement("textarea");
  input.value = url;
  input.readOnly = true;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Unable to copy game link");
}

export function HomePage() {
  const navigate = useNavigate();
  const [preferences, setPreferences] = useState<GamePreferences>(() => loadPreferences());
  const [draftName, setDraftName] = useState(preferences.playerName);
  const [draftColor, setDraftColor] = useState(preferences.playerRingColor);
  const [draftLanguage, setDraftLanguage] = useState<Language>(preferences.language);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focusedMenu, setFocusedMenu] = useState(0);
  const [toastMessage, setToastMessage] = useState("");
  const [eatCount, setEatCount] = useState(2847193);
  const [onlineCount, setOnlineCount] = useState(1204);

  const menuButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const nameInput = useRef<HTMLInputElement>(null);
  const miniLayer = useRef<HTMLDivElement>(null);
  const holeScene = useRef<HTMLDivElement>(null);
  const starsLayer = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number | null>(null);

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
      action: "share",
      title: translate(preferences.language, "share"),
      subtitle: translate(preferences.language, "shareSub"),
      icon: (
        <svg viewBox="0 0 24 24">
          <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5" />
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
  ];

  useEffect(() => {
    menuButtons.current[focusedMenu]?.focus();
  }, [focusedMenu]);

  useEffect(() => {
    if (settingsOpen) nameInput.current?.focus();
  }, [settingsOpen]);

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

  // 深渊实况动态计数。
  useEffect(() => {
    const eatInterval = window.setInterval(() => {
      setEatCount((current) => current + Math.floor(Math.random() * 140 + 30));
    }, 900);
    const onlineInterval = window.setInterval(() => {
      setOnlineCount((current) => Math.max(1180, current + (Math.floor(Math.random() * 7) - 3)));
    }, 1500);
    return () => {
      window.clearInterval(eatInterval);
      window.clearInterval(onlineInterval);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) {
        window.clearTimeout(toastTimer.current);
      }
    };
  }, []);

  const showToast = (message: string): void => {
    setToastMessage(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMessage(""), 2200);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey) return;
      if (settingsOpen) {
        if (event.code === "Escape") {
          event.preventDefault();
          setSettingsOpen(false);
          menuButtons.current[1]?.focus();
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
  }, [buttons.length, settingsOpen]);

  const triggerAction = async (action: MenuAction): Promise<void> => {
    switch (action) {
      case "start":
        navigate("/game");
        return;
      case "settings":
        setDraftName(preferences.playerName);
        setDraftColor(preferences.playerRingColor);
        setDraftLanguage(preferences.language);
        setSettingsOpen(true);
        return;
      case "share":
        await shareGame();
        return;
      case "online":
        navigate("/online");
        return;
    }
  };

  const shareGame = async (): Promise<void> => {
    const url = `${window.location.origin}${window.location.pathname}#/`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: translate(preferences.language, "title"),
          text: translate(preferences.language, "shareText"),
          url,
        });
        showToast(translate(preferences.language, "shareOpened"));
      } else {
        await copyGameLink(url);
        showToast(translate(preferences.language, "linkCopied"));
      }
    } catch {
      try {
        await copyGameLink(url);
        showToast(translate(preferences.language, "linkCopied"));
      } catch {
        showToast(translate(preferences.language, "shareFailed"));
      }
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
    const nextPreferences = {
      playerName,
      playerRingColor: draftColor,
      language: draftLanguage,
    };
    setPreferences(nextPreferences);
    persistPreferences(nextPreferences);
    applyDocumentLanguage(draftLanguage);
    setSettingsOpen(false);
    menuButtons.current[1]?.focus();
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

        <aside className="home-livecard" aria-label={translate(preferences.language, "live")}>
          <div className="home-lc-head">
            <span className="home-lc-title">{translate(preferences.language, "live")}</span>
            <span className="home-lc-live">LIVE</span>
          </div>
          <div className="home-lc-row">
            <span className="home-lc-label">{translate(preferences.language, "buildings")}</span>
            <span className="home-lc-value home-lc-value-accent">{eatCount.toLocaleString()}</span>
          </div>
          <div className="home-lc-row">
            <span className="home-lc-label">{translate(preferences.language, "onlineHoles")}</span>
            <span className="home-lc-value">{onlineCount.toLocaleString()}</span>
          </div>
          <div className="home-lc-row">
            <span className="home-lc-label">{translate(preferences.language, "bestSize")}</span>
            <span className="home-lc-value home-lc-value-gold">
              Lv.9<small>· 12.6m</small>
            </span>
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
            <h2>{translate(preferences.language, "settings")}</h2>
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

      <div
        className={`home-toast ${toastMessage ? "is-visible" : ""}`}
        role="status"
        aria-live="polite"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
        <span>{toastMessage}</span>
      </div>
    </main>
  );
}
