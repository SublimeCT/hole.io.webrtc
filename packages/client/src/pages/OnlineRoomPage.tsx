import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { loadPreferences, persistPreferences } from "../app/preferences";

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

interface RoomPlayer {
  id: string;
  name: string;
  color: string;
  flag: string;
  platform: string;
  host: boolean;
  ready: boolean;
  simulated?: boolean;
}

interface PlayerPosition {
  x: number;
  y: number;
}

const GUESTS: readonly Omit<RoomPlayer, "id" | "host" | "ready">[] = [
  { name: "引力猫", color: "#ff5c8a", flag: "🇯🇵", platform: "Windows" },
  { name: "Nova", color: "#ffd23f", flag: "🇺🇸", platform: "macOS" },
  { name: "星尘旅人", color: "#3ddc97", flag: "🇨🇳", platform: "Android" },
  { name: "Astra", color: "#ff8a3d", flag: "🇫🇷", platform: "iOS" },
] as const;

const STAR_DATA = Array.from({ length: 54 }, (_, index) => ({
  left: (index * 47 + 11) % 100,
  top: (index * 31 + 7) % 100,
  size: 1 + ((index * 7) % 20) / 10,
  duration: 1.8 + ((index * 13) % 25) / 10,
  delay: -((index * 17) % 40) / 10,
}));

function detectPlatform(): string {
  const userAgent = navigator.userAgent;
  if (/Android/i.test(userAgent)) return "Android";
  if (/iPhone|iPad/i.test(userAgent)) return "iOS";
  if (/Mac/i.test(userAgent)) return "macOS";
  if (/Win/i.test(userAgent)) return "Windows";
  return "Web";
}

function getPositions(playerCount: number): PlayerPosition[] {
  const guestCount = playerCount - 1;
  const patterns: Record<number, PlayerPosition[]> = {
    0: [],
    1: [{ x: 82, y: 50 }],
    2: [
      { x: 18, y: 50 },
      { x: 82, y: 50 },
    ],
    3: [
      { x: 82, y: 50 },
      { x: 20, y: 22 },
      { x: 20, y: 78 },
    ],
    4: [
      { x: 18, y: 22 },
      { x: 82, y: 22 },
      { x: 18, y: 78 },
      { x: 82, y: 78 },
    ],
  };
  return [{ x: 50, y: 50 }, ...(patterns[guestCount] ?? [])];
}

export function OnlineRoomPage() {
  const navigate = useNavigate();
  const preferences = loadPreferences();
  const [players, setPlayers] = useState<RoomPlayer[]>([
    {
      id: "host",
      name: preferences.playerName,
      color: preferences.playerRingColor,
      flag: "🇨🇳",
      platform: detectPlatform(),
      host: true,
      ready: true,
    },
  ]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftName, setDraftName] = useState(preferences.playerName);
  const [draftColor, setDraftColor] = useState(preferences.playerRingColor);
  const [toast, setToast] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | null>(null);

  const positions = getPositions(players.length);
  const hasRealGuest = players.some((player) => !player.host && !player.simulated);
  const allReady = players.length > 1 && players.every((player) => player.ready);
  const hasDuplicateColor = new Set(players.map((player) => player.color)).size !== players.length;
  const reason = hasDuplicateColor
    ? "存在重复颜色，请调整"
    : players.length < 2
      ? "至少需要 2 位玩家"
      : !allReady
        ? "等待所有玩家准备"
        : "所有玩家已就绪";

  useEffect(() => {
    const syncRealRoomState = (event: Event): void => {
      const roomPlayers = (event as CustomEvent<RoomPlayer[]>).detail;
      if (!Array.isArray(roomPlayers)) return;
      setPlayers(roomPlayers.slice(0, 5).map((player) => ({ ...player, simulated: false })));
    };
    window.addEventListener("void-room-state", syncRealRoomState);
    return () => window.removeEventListener("void-room-state", syncRealRoomState);
  }, []);

  useEffect(() => {
    if (settingsOpen) nameInput.current?.focus();
  }, [settingsOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (settingsOpen) setSettingsOpen(false);
      else navigate("/");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, settingsOpen]);

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const showToast = (message: string): void => {
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 1900);
  };

  const addGuest = (): void => {
    if (!import.meta.env.DEV || hasRealGuest) return;
    const guest = GUESTS[players.length - 1];
    if (!guest) return;
    const id = `guest-${players.length}`;
    setPlayers((current) => [
      ...current,
      { ...guest, id, host: false, ready: false, simulated: true },
    ]);
    window.setTimeout(() => {
      setPlayers((current) =>
        current.map((player) => (player.id === id ? { ...player, ready: true } : player)),
      );
      showToast(`${guest.name} 已准备`);
    }, 900);
  };

  const copyInvite = async (): Promise<void> => {
    const inviteUrl = `${window.location.origin}${window.location.pathname}#/online?room=V7K29Q`;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      showToast("邀请链接已复制");
    } catch {
      showToast("房间代码：V7K29Q");
    }
  };

  const saveSettings = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const name = draftName.trim();
    if (name.length < 1 || name.length > 9) {
      nameInput.current?.setCustomValidity("玩家名称长度需为 1 至 9 个字符");
      nameInput.current?.reportValidity();
      return;
    }
    const nextPreferences = { ...preferences, playerName: name, playerRingColor: draftColor };
    persistPreferences(nextPreferences);
    setPlayers((current) =>
      current.map((player) => (player.host ? { ...player, name, color: draftColor } : player)),
    );
    setSettingsOpen(false);
    showToast("玩家设置已同步");
  };

  return (
    <main className="online-room">
      <div className="online-bg" aria-hidden="true">
        <div className="online-grid" />
        {STAR_DATA.map((star, index) => (
          <i
            className="online-star"
            key={index}
            style={
              {
                left: `${star.left}%`,
                top: `${star.top}%`,
                width: `${star.size}px`,
                height: `${star.size}px`,
                "--star-duration": `${star.duration}s`,
                animationDelay: `${star.delay}s`,
              } as CSSProperties
            }
          />
        ))}
      </div>

      <div className="online-app">
        <header className="online-topbar">
          <div className="online-brand">
            <img
              className="online-brand-mark"
              src={`${import.meta.env.BASE_URL}void-mark.svg?v=5`}
              width="36"
              height="36"
              alt=""
              aria-hidden="true"
            />
            <div className="online-brand-copy">
              <b>VOID 联机房间</b>
              <span>
                房间代码 <strong>V7K29Q</strong>
              </span>
            </div>
          </div>
          <div className="online-top-actions">
            <button className="online-ghost-btn" type="button" onClick={() => void copyInvite()}>
              复制邀请链接
            </button>
            <button
              className="online-icon-btn"
              type="button"
              aria-label="玩家设置"
              title="玩家设置"
              onClick={() => setSettingsOpen(true)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="3.2" />
                <path d="M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 2h-5l-.3 2.5a7 7 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.3 2.5h5l.3-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6a7 7 0 0 0 .1-1z" />
              </svg>
            </button>
            <button
              className="online-icon-btn"
              type="button"
              aria-label="离开房间"
              title="离开房间"
              onClick={() => navigate("/")}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10" />
              </svg>
            </button>
          </div>
        </header>

        <section className={`online-arena players-${players.length}`} aria-label="房间玩家连接图">
          <div className="online-status-pill">
            <i />
            <span>
              {players.length === 1
                ? "房间已创建 · 等待玩家加入"
                : `${players.length} / 5 位玩家已连接`}
            </span>
          </div>
          <svg
            className="online-connections"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {players.slice(1).map((player, index) => (
              <line
                key={player.id}
                x1="50"
                y1="50"
                x2={positions[index + 1]?.x}
                y2={positions[index + 1]?.y}
                stroke={player.color}
                style={{ color: player.color }}
              />
            ))}
          </svg>
          {players.map((player, index) => {
            const position = positions[index] ?? { x: 50, y: 50 };
            return (
              <div
                className={`online-hole ${player.host ? "is-host" : ""}`}
                key={player.id}
                style={
                  {
                    left: `${position.x}%`,
                    top: `${position.y}%`,
                    "--ring": player.color,
                    "--entry-delay": `${index * 80}ms`,
                  } as CSSProperties
                }
              >
                <div className="online-hole-glow" />
                <div className="online-hole-ring" />
                <div className="online-hole-core" />
                <div className={`online-player-tag ${player.ready ? "is-ready" : ""}`}>
                  <b>{player.name}</b>
                  <span className="online-player-meta">
                    <span>{player.flag}</span>
                    <span>{player.platform}</span>
                    {player.host ? (
                      <span className="online-crown">房主</span>
                    ) : (
                      <>
                        <i />
                        <span>{player.ready ? "已准备" : "未准备"}</span>
                      </>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
          <div className="online-reason">{reason}</div>
        </section>

        <footer className="online-bottom">
          <div className="online-roster" aria-label="房间玩家列表">
            {players.map((player) => (
              <div
                className="online-slot"
                key={player.id}
                style={{ "--ring": player.color } as CSSProperties}
              >
                <i />
                <div>
                  <b>{player.name}</b>
                  <span>
                    {player.flag} {player.host ? "房主" : player.ready ? "已准备" : "未准备"}
                  </span>
                </div>
              </div>
            ))}
            {Array.from({ length: 5 - players.length }, (_, index) => (
              <div className="online-slot is-empty" key={index}>
                等待连接
              </div>
            ))}
          </div>
          <div className="online-controls">
            {import.meta.env.DEV ? (
              <button
                className="online-action"
                type="button"
                disabled={players.length >= 5 || hasRealGuest}
                onClick={addGuest}
              >
                模拟玩家加入
              </button>
            ) : null}
            <button
              className="online-action is-primary"
              type="button"
              disabled={hasDuplicateColor || !allReady}
              onClick={() => showToast("正在同步所有玩家…")}
            >
              开始游戏
            </button>
          </div>
        </footer>
      </div>

      {settingsOpen ? (
        <div
          className="online-modal-bg"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
          <form
            className="online-modal"
            role="dialog"
            aria-modal="true"
            aria-label="玩家设置"
            onSubmit={saveSettings}
          >
            <h2>设置</h2>
            <div className="online-field">
              <label htmlFor="online-player-name">玩家名称（1–9 字）</label>
              <input
                ref={nameInput}
                id="online-player-name"
                name="playerName"
                value={draftName}
                minLength={1}
                maxLength={9}
                autoComplete="nickname"
                spellCheck={false}
                required
                onChange={(event) => {
                  event.currentTarget.setCustomValidity("");
                  setDraftName(event.currentTarget.value);
                }}
              />
              <span>将在对局排名与结算中显示</span>
            </div>
            <div className="online-field">
              <label>黑洞圆环颜色（12 款）</label>
              <div className="online-swatches">
                {RING_COLORS.map((color) => {
                  const occupied = players.some((player) => !player.host && player.color === color);
                  return (
                    <button
                      className={`online-swatch ${draftColor === color ? "is-on" : ""}`}
                      key={color}
                      type="button"
                      disabled={occupied}
                      aria-label={occupied ? "此颜色已被占用" : `选择颜色 ${color}`}
                      style={{ "--swatch": color } as CSSProperties}
                      onClick={() => setDraftColor(color)}
                    />
                  );
                })}
              </div>
            </div>
            <div className="online-modal-actions">
              <button type="button" onClick={() => setSettingsOpen(false)}>
                取消 (Esc)
              </button>
              <button className="is-primary" type="submit">
                保存 (Enter)
              </button>
            </div>
          </form>
        </div>
      ) : null}
      <div className={`online-toast ${toast ? "is-showing" : ""}`} role="status" aria-live="polite">
        {toast}
      </div>
    </main>
  );
}
