// 联机会话的生命周期容器。MultiplayerSession 在 /online 与 /game 之间切换时保持存活，
// 避免 OnlineRoomPage 卸载就 dispose 掉已经建好的信令+WebRTC 连接。仅在离开房间时销毁。
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import type { PlayerProfile, RoomCode } from "@hole-io/shared/protocol";

import { MultiplayerSession } from "./multiplayerSession";

export interface EnsureSessionInput {
  roomCode: RoomCode | null;
  profile: PlayerProfile;
  onRoomCode: (roomCode: RoomCode) => void;
}

interface MultiplayerContextValue {
  session: MultiplayerSession | null;
  ensureSession(input: EnsureSessionInput): void;
  disposeSession(): void;
}

const MultiplayerContext = createContext<MultiplayerContextValue | null>(null);

export function MultiplayerProvider({ children }: { children: ReactNode }): ReactNode {
  const sessionRef = useRef<MultiplayerSession | null>(null);
  const [session, setSession] = useState<MultiplayerSession | null>(null);

  const ensureSession = useCallback((input: EnsureSessionInput): void => {
    if (sessionRef.current !== null) return;
    const created = new MultiplayerSession({
      profile: input.profile,
      requestedRoomCode: input.roomCode,
      onRoomCode: input.onRoomCode,
    });
    sessionRef.current = created;
    setSession(created);
    created.start();
  }, []);

  const disposeSession = useCallback((): void => {
    const current = sessionRef.current;
    if (current === null) return;
    current.dispose(true);
    sessionRef.current = null;
    setSession(null);
  }, []);

  return (
    <MultiplayerContext.Provider value={{ session, ensureSession, disposeSession }}>
      {children}
    </MultiplayerContext.Provider>
  );
}

export function useMultiplayer(): MultiplayerContextValue {
  const ctx = useContext(MultiplayerContext);
  if (ctx === null) throw new Error("useMultiplayer 必须在 MultiplayerProvider 内使用");
  return ctx;
}
