import type {
  PeerId,
  RoomClosedReason,
  RoomState,
  TurnCredentials,
} from "@hole-io/shared/protocol";
import { createStore } from "zustand/vanilla";

export type SignalingStatus = "idle" | "connecting" | "open" | "closed" | "error";
export type PeerConnectionStatus = "connecting" | "connected" | "failed" | "closed";
/** WebRTC 连接类型：direct = host/srflx 直连或 STUN 打洞；relay = TURN 中继。 */
export type PeerConnectionType = "direct" | "relay";
/**
 * 会话终止原因。仅 room-closed / kicked 置位（应回主页），瞬时 error 不置位（仅 toast），
 * 供 GamePage 区分「房间解散/被踢需回主页」与「可恢复的瞬时错误」。
 */
export type SessionTermination = RoomClosedReason | "kicked";

export interface MultiplayerState {
  signalingStatus: SignalingStatus;
  peerId: PeerId | null;
  room: RoomState | null;
  turn: TurnCredentials | null;
  matchId: string | null;
  latencyMs: number | null;
  peerConnections: Readonly<Record<string, PeerConnectionStatus>>;
  peerConnectionTypes: Readonly<Record<string, PeerConnectionType>>;
  error: string | null;
  termination: SessionTermination | null;
  setSignalingStatus(status: SignalingStatus): void;
  setIdentity(peerId: PeerId): void;
  setRoom(room: RoomState, turn?: TurnCredentials): void;
  clearRoom(): void;
  setMatch(matchId: string | null): void;
  setLatency(latencyMs: number): void;
  setPeerConnection(peerId: PeerId, status: PeerConnectionStatus): void;
  setPeerConnectionType(peerId: PeerId, type: PeerConnectionType): void;
  clearPeerConnections(): void;
  setError(error: string | null): void;
  setTermination(termination: SessionTermination | null): void;
  reset(): void;
}

const initialState = {
  signalingStatus: "idle" as const,
  peerId: null,
  room: null,
  turn: null,
  matchId: null,
  latencyMs: null,
  peerConnections: {},
  peerConnectionTypes: {},
  error: null,
  termination: null,
};

export const multiplayerStore = createStore<MultiplayerState>((set) => ({
  ...initialState,
  setSignalingStatus: (signalingStatus) => set({ signalingStatus }),
  setIdentity: (peerId) => set({ peerId }),
  setRoom: (room, turn) =>
    set((state) => ({ room, turn: turn ?? state.turn, error: null, termination: null })),
  clearRoom: () =>
    set({
      room: null,
      turn: null,
      matchId: null,
      peerConnections: {},
      peerConnectionTypes: {},
    }),
  setMatch: (matchId) => set({ matchId }),
  setLatency: (latencyMs) => set({ latencyMs }),
  setPeerConnection: (peerId, status) =>
    set((state) => ({
      peerConnections: { ...state.peerConnections, [peerId]: status },
    })),
  setPeerConnectionType: (peerId, type) =>
    set((state) => ({
      peerConnectionTypes: { ...state.peerConnectionTypes, [peerId]: type },
    })),
  clearPeerConnections: () => set({ peerConnections: {}, peerConnectionTypes: {} }),
  setError: (error) => set({ error }),
  setTermination: (termination) => set({ termination }),
  reset: () => set(initialState),
}));
