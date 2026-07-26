import {
  PLAYER_NAME_PATTERN,
  type PeerId,
  type RoomCode,
  type RoomPeer,
} from "@hole-io/shared/protocol";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useStore } from "zustand";
import { loadPreferences, persistPreferences } from "../app/preferences";
import { createPlayerProfile, MultiplayerSession } from "../net/multiplayerSession";
import { multiplayerStore } from "../store/multiplayerStore";

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
  id: PeerId;
  name: string;
  color: string;
  flag: string;
  platform: string;
  host: boolean;
  entered: boolean;
  ready: boolean;
}

interface PlayerPosition {
  x: number;
  y: number;
}

const STAR_DATA = Array.from({ length: 54 }, (_, index) => ({
  left: (index * 47 + 11) % 100,
  top: (index * 31 + 7) % 100,
  size: 1 + ((index * 7) % 20) / 10,
  duration: 1.8 + ((index * 13) % 25) / 10,
  delay: -((index * 17) % 40) / 10,
}));

const LANGUAGE_FLAGS: Readonly<Record<RoomPeer["profile"]["language"], string>> = {
  "zh-CN": "🇨🇳",
  "zh-TW": "🇹🇼",
  en: "🇺🇸",
  fr: "🇫🇷",
  ja: "🇯🇵",
  es: "🇪🇸",
  ko: "🇰🇷",
  de: "🇩🇪",
  pt: "🇵🇹",
  ar: "🌐",
};

function detectPlatform(): string {
  const userAgent = navigator.userAgent;
  if (/Android/i.test(userAgent)) return "Android";
  if (/iPhone|iPad/i.test(userAgent)) return "iOS";
  if (/Mac/i.test(userAgent)) return "macOS";
  if (/Win/i.test(userAgent)) return "Windows";
  return "Web";
}

function getPositions(playerCount: number): PlayerPosition[] {
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
  return [{ x: 50, y: 50 }, ...(patterns[playerCount - 1] ?? [])];
}

function requestedRoomCode(search: string): RoomCode | null {
  const roomCode = new URLSearchParams(search).get("room")?.toUpperCase() ?? "";
  return /^[A-HJ-NP-Z2-9]{6}$/.test(roomCode) ? (roomCode as RoomCode) : null;
}

function mapPlayers(peers: readonly RoomPeer[]): RoomPlayer[] {
  return [...peers]
    .sort((left, right) => Number(right.isHost) - Number(left.isHost))
    .map((peer) => ({
      id: peer.peerId,
      name: peer.profile.playerName,
      color: peer.profile.color,
      flag: LANGUAGE_FLAGS[peer.profile.language],
      platform: peer.profile.platform,
      host: peer.isHost,
      entered: peer.entered,
      ready: peer.ready,
    }));
}

export function OnlineRoomPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [preferences, setPreferences] = useState(() => loadPreferences());
  const [initialRoomCode] = useState(() => requestedRoomCode(location.search));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftName, setDraftName] = useState(preferences.playerName);
  const [draftColor, setDraftColor] = useState(preferences.playerRingColor);
  const [toast, setToast] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | null>(null);
  const session = useRef<MultiplayerSession | null>(null);
  const initialProfile = useRef(
    createPlayerProfile({
      playerName: preferences.playerName,
      color: preferences.playerRingColor,
      language: preferences.language,
      platform: detectPlatform(),
    }),
  );

  const room = useStore(multiplayerStore, (state) => state.room);
  const peerId = useStore(multiplayerStore, (state) => state.peerId);
  const signalingStatus = useStore(multiplayerStore, (state) => state.signalingStatus);
  const latencyMs = useStore(multiplayerStore, (state) => state.latencyMs);
  const peerConnections = useStore(multiplayerStore, (state) => state.peerConnections);
  const connectionError = useStore(multiplayerStore, (state) => state.error);
  const matchId = useStore(multiplayerStore, (state) => state.matchId);

  const players = room === null ? [] : mapPlayers(room.peers);
  const positions = getPositions(players.length);
  const localPeer = room?.peers.find((peer) => peer.peerId === peerId) ?? null;
  const enteredPlayers = room?.peers.filter((peer) => peer.entered) ?? [];
  const allReady = enteredPlayers.length > 1 && enteredPlayers.every((peer) => peer.ready);
  const hasDuplicateColor =
    new Set(enteredPlayers.map((peer) => peer.profile.color)).size !== enteredPlayers.length;
  const connectedRtcPeers = Object.values(peerConnections).filter(
    (status) => status === "connected",
  ).length;

  const showToast = useCallback((message: string): void => {
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2200);
  }, []);

  const leaveRoom = useCallback((): void => {
    session.current?.leave();
    navigate("/");
  }, [navigate]);

  useEffect(() => {
    const multiplayerSession = new MultiplayerSession({
      profile: initialProfile.current,
      requestedRoomCode: initialRoomCode,
      onRoomCode: (roomCode) => {
        navigate({ pathname: "/online", search: `?room=${roomCode}` }, { replace: true });
      },
    });
    session.current = multiplayerSession;
    multiplayerSession.start();
    return () => {
      multiplayerSession.dispose(true);
      session.current = null;
    };
  }, [initialRoomCode, navigate]);

  useEffect(() => {
    if (settingsOpen) nameInput.current?.focus();
  }, [settingsOpen]);

  useEffect(() => {
    if (connectionError) showToast(connectionError);
  }, [connectionError, showToast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (settingsOpen) setSettingsOpen(false);
      else leaveRoom();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [leaveRoom, settingsOpen]);

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const copyInvite = async (): Promise<void> => {
    if (room === null) return;
    const inviteUrl = `${window.location.origin}${window.location.pathname}#/online?room=${room.roomCode}`;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      showToast("邀请链接已复制");
    } catch {
      showToast(`房间代码：${room.roomCode}`);
    }
  };

  const primaryAction = (): void => {
    if (room?.status !== "lobby" || localPeer === null) return;
    if (localPeer.isHost && allReady && !hasDuplicateColor) {
      session.current?.beginConnection();
      return;
    }
    session.current?.setReady(!localPeer.ready);
  };

  const saveSettings = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const name = draftName.normalize("NFKC").trim();
    const nameLength = Array.from(name).length;
    if (nameLength < 2 || nameLength > 10 || !PLAYER_NAME_PATTERN.test(name)) {
      nameInput.current?.setCustomValidity(
        "玩家名称需为 2 至 10 个字符，且只能包含文字、数字、空格、短横线或下划线",
      );
      nameInput.current?.reportValidity();
      return;
    }
    const nextPreferences = { ...preferences, playerName: name, playerRingColor: draftColor };
    const profile = createPlayerProfile({
      playerName: name,
      color: draftColor,
      language: preferences.language,
      platform: detectPlatform(),
    });
    setPreferences(nextPreferences);
    persistPreferences(nextPreferences);
    session.current?.updateProfile(profile);
    setSettingsOpen(false);
    showToast("玩家设置已同步，准备状态已重置");
  };

  const reason = roomReason({
    roomStatus: room?.status ?? null,
    signalingStatus,
    playerCount: enteredPlayers.length,
    allReady,
    hasDuplicateColor,
    matchId,
    connectedRtcPeers,
  });
  const actionLabel = primaryActionLabel(room?.status ?? null, localPeer, allReady);
  const actionDisabled =
    room === null ||
    localPeer === null ||
    room.status !== "lobby" ||
    (localPeer.isHost && allReady && hasDuplicateColor);

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
                房间代码 <strong>{room?.roomCode ?? "------"}</strong>
              </span>
            </div>
          </div>
          <div className="online-top-actions">
            <button
              className="online-ghost-btn"
              type="button"
              disabled={room === null}
              onClick={() => void copyInvite()}
            >
              复制邀请链接
            </button>
            <button
              className="online-icon-btn"
              type="button"
              disabled={room?.status !== "lobby"}
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
              onClick={leaveRoom}
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
              {signalingStatus !== "open"
                ? "正在连接信令服务器"
                : `${enteredPlayers.length} / 5 位玩家 · ${latencyMs ?? "--"}ms`}
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
                    {player.host ? <span className="online-crown">房主</span> : null}
                    <i />
                    <span>
                      {player.entered ? (player.ready ? "已准备" : "未准备") : "待重新进入"}
                    </span>
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
            {Array.from({ length: Math.max(0, 5 - players.length) }, (_, index) => (
              <div className="online-slot is-empty" key={index}>
                等待连接
              </div>
            ))}
          </div>
          <div className="online-controls">
            <button
              className="online-action is-primary"
              type="button"
              disabled={actionDisabled}
              onClick={primaryAction}
            >
              {actionLabel}
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
              <label htmlFor="online-player-name">玩家名称（2–10 字）</label>
              <input
                ref={nameInput}
                id="online-player-name"
                name="playerName"
                value={draftName}
                minLength={2}
                maxLength={10}
                autoComplete="nickname"
                spellCheck={false}
                required
                onChange={(event) => {
                  event.currentTarget.setCustomValidity("");
                  setDraftName(event.currentTarget.value);
                }}
              />
              <span>修改资料会自动取消当前准备状态</span>
            </div>
            <div className="online-field">
              <label>黑洞圆环颜色（12 款）</label>
              <div className="online-swatches">
                {RING_COLORS.map((color) => {
                  const occupied = players.some(
                    (player) => player.id !== peerId && player.color === color,
                  );
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

function primaryActionLabel(
  roomStatus: "lobby" | "connecting" | "playing" | null,
  localPeer: RoomPeer | null,
  allReady: boolean,
): string {
  if (roomStatus === "connecting") return "正在建立 WebRTC 连接";
  if (roomStatus === "playing") return "对局进行中";
  if (localPeer === null) return "连接房间中";
  if (localPeer.isHost && allReady) return "开始游戏";
  return localPeer.ready ? "取消准备" : "准备";
}

function roomReason(input: {
  roomStatus: "lobby" | "connecting" | "playing" | null;
  signalingStatus: string;
  playerCount: number;
  allReady: boolean;
  hasDuplicateColor: boolean;
  matchId: string | null;
  connectedRtcPeers: number;
}): string {
  if (input.signalingStatus === "connecting") return "正在连接房间服务";
  if (input.signalingStatus === "error") return "房间服务连接失败";
  if (input.roomStatus === "connecting") {
    return `正在建立星型连接 · ${input.connectedRtcPeers} 条已就绪`;
  }
  if (input.roomStatus === "playing") {
    return input.matchId === null ? "等待对局确认" : "对局已开始 · 权威游戏循环待接入";
  }
  if (input.hasDuplicateColor) return "存在重复颜色，请调整";
  if (input.playerCount < 2) return "至少需要 2 位玩家";
  if (!input.allReady) return "等待所有玩家准备";
  return "所有玩家已就绪，房主可以开始";
}
