import type { PlayerProfile, RoomCode, RoomStatus } from "@hole-io/shared/protocol";

export interface PersistedMember {
  peerId: string;
  profile: PlayerProfile;
  isHost: boolean;
}

export interface IpAccessState {
  ip: string;
  consecutiveMisses: number;
  totalMisses: number;
  blockedUntil: number | null;
  permanentlyBlocked: boolean;
  updatedAt: number;
}

export interface Persistence {
  reserveRoom(input: {
    code: RoomCode;
    hostPeerId: string;
    status: RoomStatus;
    cycle: number;
    now: number;
  }): Promise<boolean>;
  updateRoom(input: {
    code: RoomCode;
    status: RoomStatus | "closed";
    cycle: number;
    now: number;
    closedAt?: number;
  }): Promise<void>;
  createMatch(input: {
    id: string;
    roomCode: RoomCode;
    cycle: number;
    startedAt: number;
    endsAt: number;
    members: readonly PersistedMember[];
  }): Promise<void>;
  finishMatch(input: {
    id: string;
    finishedAt: number;
    reason: "time-limit" | "host-timeout" | "host-left" | "closed" | "server-shutdown";
  }): Promise<void>;
  getIpAccess(ip: string): Promise<IpAccessState | null>;
  saveIpAccess(state: IpAccessState): Promise<void>;
  health(): Promise<boolean>;
}
