import type { PeerId, RoomState, TurnCredentials } from "@hole-io/shared/protocol";
import { createStore } from "zustand/vanilla";

export type SignalingStatus = "idle" | "connecting" | "open" | "closed" | "error";
export type PeerConnectionStatus = "connecting" | "connected" | "failed" | "closed";

export interface MultiplayerState {
  signalingStatus: SignalingStatus;
  peerId: PeerId | null;
  room: RoomState | null;
  turn: TurnCredentials | null;
  matchId: string | null;
  latencyMs: number | null;
  peerConnections: Readonly<Record<string, PeerConnectionStatus>>;
  error: string | null;
  setSignalingStatus(status: SignalingStatus): void;
  setIdentity(peerId: PeerId): void;
  setRoom(room: RoomState, turn?: TurnCredentials): void;
  clearRoom(): void;
  setMatch(matchId: string | null): void;
  setLatency(latencyMs: number): void;
  setPeerConnection(peerId: PeerId, status: PeerConnectionStatus): void;
  clearPeerConnections(): void;
  setError(error: string | null): void;
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
  error: null,
};

export const multiplayerStore = createStore<MultiplayerState>((set) => ({
  ...initialState,
  setSignalingStatus: (signalingStatus) => set({ signalingStatus }),
  setIdentity: (peerId) => set({ peerId }),
  setRoom: (room, turn) => set((state) => ({ room, turn: turn ?? state.turn, error: null })),
  clearRoom: () => set({ room: null, turn: null, matchId: null, peerConnections: {} }),
  setMatch: (matchId) => set({ matchId }),
  setLatency: (latencyMs) => set({ latencyMs }),
  setPeerConnection: (peerId, status) =>
    set((state) => ({
      peerConnections: { ...state.peerConnections, [peerId]: status },
    })),
  clearPeerConnections: () => set({ peerConnections: {} }),
  setError: (error) => set({ error }),
  reset: () => set(initialState),
}));
