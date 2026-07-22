import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { loadPreferences, persistPreferences, type GamePreferences } from "../app/preferences";

const COLORS = [
  ["#6ef2d0", "color-mint", "薄荷绿"],
  ["#ff7a63", "color-coral", "珊瑚红"],
  ["#ffdf4d", "color-sun", "日光黄"],
  ["#9c8cff", "color-violet", "紫罗兰"],
  ["#5aa9ff", "color-blue", "天空蓝"],
  ["#55d68b", "color-green", "青草绿"],
  ["#ff9f43", "color-orange", "橙色"],
  ["#ff80b5", "color-pink", "粉红"],
  ["#e64e6e", "color-rose", "玫瑰红"],
  ["#b7e64e", "color-lime", "青柠"],
  ["#d7f4ff", "color-ice", "冰蓝"],
  ["#c78a56", "color-bronze", "青铜"],
] as const;

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [onlineOpen, setOnlineOpen] = useState(false);
  const [shareStatus, setShareStatus] = useState("");
  const [focusedMenu, setFocusedMenu] = useState(0);
  const menuButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const nameInput = useRef<HTMLInputElement>(null);
  const onlineCloseButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    menuButtons.current[focusedMenu]?.focus();
  }, [focusedMenu]);

  useEffect(() => {
    if (settingsOpen) nameInput.current?.focus();
  }, [settingsOpen]);

  useEffect(() => {
    if (onlineOpen) onlineCloseButton.current?.focus();
  }, [onlineOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey) return;
      if (settingsOpen || onlineOpen) {
        if (event.code === "Escape") {
          event.preventDefault();
          setSettingsOpen(false);
          setOnlineOpen(false);
          menuButtons.current[settingsOpen ? 1 : 2]?.focus();
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
        setFocusedMenu((current) => (current + offset + 4) % 4);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onlineOpen, settingsOpen]);

  const openSettings = (): void => {
    setDraftName(preferences.playerName);
    setDraftColor(preferences.playerRingColor);
    setSettingsOpen(true);
  };

  const submitSettings = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const playerName = draftName.trim();
    if (playerName.length < 1 || playerName.length > 9) {
      nameInput.current?.setCustomValidity("玩家名称长度需为 1 至 9 个字符");
      nameInput.current?.reportValidity();
      return;
    }
    nameInput.current?.setCustomValidity("");
    const nextPreferences = { playerName, playerRingColor: draftColor };
    setPreferences(nextPreferences);
    persistPreferences(nextPreferences);
    setSettingsOpen(false);
    menuButtons.current[1]?.focus();
  };

  const shareGame = async (): Promise<void> => {
    const url = `${window.location.origin}${window.location.pathname}#/`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Hole City", text: "来吞掉这座城市", url });
        setShareStatus("已打开分享面板");
      } else {
        await copyGameLink(url);
        setShareStatus("游戏链接已复制");
      }
    } catch {
      try {
        await copyGameLink(url);
        setShareStatus("游戏链接已复制");
      } catch {
        setShareStatus("暂时无法分享链接");
      }
    }
  };

  return (
    <main className="app-shell is-menu">
      <div className="screen-texture" aria-hidden="true" />
      <section className="overlay menu-overlay" aria-label="开局菜单">
        <div className="menu-copy">
          <span className="kicker">SINK CITY / COMPETITIVE RUN</span>
          <h1>吞城计划</h1>
          <p>三分钟城市吞噬竞技</p>
          <div className="menu-actions">
            <button
              ref={(element) => {
                menuButtons.current[0] = element;
              }}
              className={`primary-command ${focusedMenu === 0 ? "is-menu-focused" : ""}`}
              type="button"
              onFocus={() => setFocusedMenu(0)}
              onClick={() => navigate("/game")}
            >
              <span>开始游戏</span>
            </button>
            <button
              ref={(element) => {
                menuButtons.current[1] = element;
              }}
              className={`secondary-command ${focusedMenu === 1 ? "is-menu-focused" : ""}`}
              type="button"
              onFocus={() => setFocusedMenu(1)}
              onClick={openSettings}
            >
              <span>设置</span>
            </button>
            <button
              ref={(element) => {
                menuButtons.current[2] = element;
              }}
              className={`secondary-command ${focusedMenu === 2 ? "is-menu-focused" : ""}`}
              type="button"
              onFocus={() => setFocusedMenu(2)}
              onClick={() => setOnlineOpen(true)}
            >
              <span>联机游玩</span>
            </button>
            <button
              ref={(element) => {
                menuButtons.current[3] = element;
              }}
              className={`secondary-command ${focusedMenu === 3 ? "is-menu-focused" : ""}`}
              type="button"
              onFocus={() => setFocusedMenu(3)}
              onClick={() => void shareGame()}
            >
              <span>分享游戏</span>
            </button>
            <span className="menu-status" role="status" aria-live="polite">
              {shareStatus}
            </span>
          </div>
        </div>
        <aside className="menu-brief" aria-label="对局信息">
          <span className="panel-label">MATCH BRIEF</span>
          <strong>单机对局</strong>
          <div className="brief-grid">
            <span>
              <b>03</b> 玩家
            </span>
            <span>
              <b>03:00</b> 时长
            </span>
            <span>
              <b>01</b> 次复活
            </span>
          </div>
          <i>城市吞噬赛</i>
        </aside>
      </section>

      <section className="dialog-layer" aria-labelledby="settings-title" hidden={!settingsOpen}>
        <form className="dialog-sheet" onSubmit={submitSettings}>
          <header>
            <span className="result-mark">*</span>
            <div>
              <span className="kicker">PLAYER PROFILE</span>
              <h2 id="settings-title">设置</h2>
            </div>
          </header>
          <label className="settings-field" htmlFor="player-name">
            <span>玩家名称</span>
            <input
              ref={nameInput}
              id="player-name"
              name="player-name"
              minLength={1}
              maxLength={9}
              autoComplete="nickname"
              required
              value={draftName}
              onChange={(event) => {
                event.currentTarget.setCustomValidity("");
                setDraftName(event.currentTarget.value);
              }}
            />
          </label>
          <fieldset className="color-picker">
            <legend>黑洞圆环</legend>
            <div>
              {COLORS.map(([color, className, label]) => (
                <button
                  key={color}
                  className={`color-swatch ${className} ${draftColor === color ? "is-selected" : ""}`}
                  type="button"
                  aria-label={label}
                  aria-pressed={draftColor === color}
                  onClick={() => setDraftColor(color)}
                />
              ))}
            </div>
          </fieldset>
          <footer className="dialog-actions">
            <button
              className="text-command"
              type="button"
              onClick={() => {
                setSettingsOpen(false);
                requestAnimationFrame(() => menuButtons.current[1]?.focus());
              }}
            >
              <span>取消</span>
              <b className="key-hint">ESC</b>
            </button>
            <button className="primary-command" type="submit">
              <span>保存设置</span>
              <b className="key-hint">ENTER</b>
            </button>
          </footer>
        </form>
      </section>

      <section className="dialog-layer" aria-labelledby="online-title" hidden={!onlineOpen}>
        <div className="dialog-sheet dialog-notice">
          <header>
            <span className="result-mark">!</span>
            <div>
              <span className="kicker">ONLINE MODE</span>
              <h2 id="online-title">开发中</h2>
            </div>
          </header>
          <p>联机竞技正在准备中。当前可直接开始单机对局。</p>
          <footer className="dialog-actions">
            <button
              ref={onlineCloseButton}
              className="primary-command"
              type="button"
              onClick={() => {
                setOnlineOpen(false);
                requestAnimationFrame(() => menuButtons.current[2]?.focus());
              }}
            >
              <span>关闭</span>
              <b className="key-hint">ESC</b>
            </button>
          </footer>
        </div>
      </section>
    </main>
  );
}
