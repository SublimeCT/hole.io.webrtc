import { randomUUID } from "node:crypto";
import type {
  PeerId,
  PlayerProfile,
  RoomClosedReason,
  RoomCode,
  RoomState,
  RoomStatus,
} from "@hole-io/shared/protocol";
import {
  CONNECTION_TIMEOUT_MS,
  HEARTBEAT_TIMEOUT_MS,
  MATCH_DURATION_MS,
  MAX_PEERS_PER_ROOM,
  MAX_ROOMS,
  ROOM_IDLE_MS,
} from "../constants.js";
import type { Persistence } from "../db/persistence.js";
import { generateRoomCode } from "./roomCode.js";

export interface RoomMember {
  peerId: PeerId;
  profile: PlayerProfile;
  isHost: boolean;
  entered: boolean;
  ready: boolean;
  lastHeartbeatAt: number;
}

interface ActiveMatch {
  id: string;
  endsAt: number;
}

export interface Room {
  code: RoomCode;
  hostPeerId: PeerId;
  status: RoomStatus;
  cycle: number;
  members: Map<PeerId, RoomMember>;
  lobbyExpiresAt: number | null;
  connectionExpiresAt: number | null;
  match: ActiveMatch | null;
}

export type RoomEvent =
  | { type: "room-state"; room: RoomState; recipients: readonly PeerId[] }
  | {
      type: "room-closed";
      roomCode: RoomCode;
      reason: RoomClosedReason;
      recipients: readonly PeerId[];
    }
  | {
      type: "match-ended";
      matchId: string;
      roomCode: RoomCode;
      rejoinDeadline: number;
      recipients: readonly PeerId[];
    };

export type RoomFailure =
  | "ROOM_UNAVAILABLE"
  | "ROOM_FULL"
  | "PLAYER_NAME_TAKEN"
  | "ROOM_LIMIT_REACHED"
  | "ALREADY_IN_ROOM"
  | "NOT_IN_ROOM"
  | "NOT_HOST"
  | "NOT_READY"
  | "INVALID_STATE"
  | "SIGNAL_NOT_ALLOWED";

export type RoomResult<T> = { ok: true; value: T } | { ok: false; error: RoomFailure };

export class RoomService {
  private readonly rooms = new Map<RoomCode, Room>();
  private readonly peerRooms = new Map<PeerId, RoomCode>();
  private readonly persistence: Persistence;
  private readonly now: () => number;

  constructor(persistence: Persistence, now: () => number) {
    this.persistence = persistence;
    this.now = now;
  }

  get size(): number {
    return this.rooms.size;
  }

  roomForPeer(peerId: PeerId): Room | undefined {
    const code = this.peerRooms.get(peerId);
    return code === undefined ? undefined : this.rooms.get(code);
  }

  getRoom(code: RoomCode): Room | undefined {
    return this.rooms.get(code);
  }

  state(room: Room): RoomState {
    return {
      roomCode: room.code,
      status: room.status,
      cycle: room.cycle,
      peers: [...room.members.values()].map((member) => ({
        peerId: member.peerId,
        profile: member.profile,
        isHost: member.isHost,
        entered: member.entered,
        ready: member.ready,
      })),
      lobbyExpiresAt: room.lobbyExpiresAt,
      connectionExpiresAt: room.connectionExpiresAt,
      matchEndsAt: room.match?.endsAt ?? null,
    };
  }

  recipients(room: Room): PeerId[] {
    return [...room.members.keys()];
  }

  async createRoom(peerId: PeerId, profile: PlayerProfile): Promise<RoomResult<Room>> {
    if (this.peerRooms.has(peerId)) return { ok: false, error: "ALREADY_IN_ROOM" };
    if (this.rooms.size >= MAX_ROOMS) return { ok: false, error: "ROOM_LIMIT_REACHED" };

    const now = this.now();
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const code = generateRoomCode();
      if (this.rooms.has(code)) continue;
      const reserved = await this.persistence.reserveRoom({
        code,
        hostPeerId: peerId,
        status: "lobby",
        cycle: 1,
        now,
      });
      if (!reserved) continue;
      const host: RoomMember = {
        peerId,
        profile,
        isHost: true,
        entered: true,
        ready: false,
        lastHeartbeatAt: now,
      };
      const room: Room = {
        code,
        hostPeerId: peerId,
        status: "lobby",
        cycle: 1,
        members: new Map([[peerId, host]]),
        lobbyExpiresAt: now + ROOM_IDLE_MS,
        connectionExpiresAt: null,
        match: null,
      };
      this.rooms.set(code, room);
      this.peerRooms.set(peerId, code);
      return { ok: true, value: room };
    }
    return { ok: false, error: "ROOM_LIMIT_REACHED" };
  }

  enterRoom(code: RoomCode, peerId: PeerId, profile: PlayerProfile): RoomResult<Room> {
    const assignedCode = this.peerRooms.get(peerId);
    if (assignedCode !== undefined && assignedCode !== code) {
      return { ok: false, error: "ALREADY_IN_ROOM" };
    }
    const room = this.rooms.get(code);
    if (room === undefined) return { ok: false, error: "ROOM_UNAVAILABLE" };
    if (room.status !== "lobby") return { ok: false, error: "ROOM_UNAVAILABLE" };

    const existing = room.members.get(peerId);
    if (this.isPlayerNameTaken(room, profile.playerName, peerId)) {
      return { ok: false, error: "PLAYER_NAME_TAKEN" };
    }
    if (existing !== undefined) {
      existing.profile = profile;
      existing.entered = true;
      existing.ready = false;
      existing.lastHeartbeatAt = this.now();
      return { ok: true, value: room };
    }
    if (room.members.size >= MAX_PEERS_PER_ROOM) {
      return { ok: false, error: "ROOM_FULL" };
    }
    room.members.set(peerId, {
      peerId,
      profile,
      isHost: false,
      entered: true,
      ready: false,
      lastHeartbeatAt: this.now(),
    });
    this.peerRooms.set(peerId, code);
    return { ok: true, value: room };
  }

  setReady(peerId: PeerId, ready: boolean): RoomResult<Room> {
    const room = this.roomForPeer(peerId);
    if (room === undefined) return { ok: false, error: "NOT_IN_ROOM" };
    if (room.status !== "lobby") return { ok: false, error: "INVALID_STATE" };
    const member = room.members.get(peerId);
    if (member === undefined || !member.entered) return { ok: false, error: "NOT_IN_ROOM" };
    member.ready = ready;
    return { ok: true, value: room };
  }

  updateProfile(peerId: PeerId, profile: PlayerProfile): RoomResult<Room> {
    const room = this.roomForPeer(peerId);
    if (room === undefined) return { ok: false, error: "NOT_IN_ROOM" };
    if (room.status !== "lobby") return { ok: false, error: "INVALID_STATE" };
    const member = room.members.get(peerId);
    if (member === undefined || !member.entered) return { ok: false, error: "NOT_IN_ROOM" };
    if (this.isPlayerNameTaken(room, profile.playerName, peerId)) {
      return { ok: false, error: "PLAYER_NAME_TAKEN" };
    }
    member.profile = profile;
    member.ready = false;
    return { ok: true, value: room };
  }

  private isPlayerNameTaken(room: Room, playerName: string, excludePeerId: PeerId): boolean {
    const key = playerName.normalize("NFKC").toLocaleLowerCase();
    return [...room.members.values()].some(
      (member) =>
        member.peerId !== excludePeerId &&
        member.profile.playerName.normalize("NFKC").toLocaleLowerCase() === key,
    );
  }

  async beginConnection(peerId: PeerId): Promise<RoomResult<Room>> {
    const room = this.roomForPeer(peerId);
    if (room === undefined) return { ok: false, error: "NOT_IN_ROOM" };
    if (room.hostPeerId !== peerId) return { ok: false, error: "NOT_HOST" };
    if (room.status !== "lobby") return { ok: false, error: "INVALID_STATE" };
    const entered = [...room.members.values()].filter((member) => member.entered);
    if (
      entered.length < 2 ||
      entered.some((member) => member.peerId !== room.hostPeerId && !member.ready)
    ) {
      return { ok: false, error: "NOT_READY" };
    }
    const now = this.now();
    room.status = "connecting";
    room.lobbyExpiresAt = null;
    room.connectionExpiresAt = now + CONNECTION_TIMEOUT_MS;
    await this.persistence.updateRoom({
      code: room.code,
      status: room.status,
      cycle: room.cycle,
      now,
    });
    return { ok: true, value: room };
  }

  signalTarget(peerId: PeerId, targetPeerId: PeerId): RoomResult<RoomMember> {
    const room = this.roomForPeer(peerId);
    if (room === undefined || (room.status !== "lobby" && room.status !== "connecting")) {
      return { ok: false, error: "SIGNAL_NOT_ALLOWED" };
    }
    const source = room.members.get(peerId);
    const target = room.members.get(targetPeerId);
    if (source === undefined || target === undefined || !source.entered || !target.entered) {
      return { ok: false, error: "SIGNAL_NOT_ALLOWED" };
    }
    if (!source.isHost && !target.isHost) {
      return { ok: false, error: "SIGNAL_NOT_ALLOWED" };
    }
    return { ok: true, value: target };
  }

  async startMatch(peerId: PeerId): Promise<RoomResult<{ room: Room; matchId: string }>> {
    const room = this.roomForPeer(peerId);
    if (room === undefined) return { ok: false, error: "NOT_IN_ROOM" };
    if (room.hostPeerId !== peerId) return { ok: false, error: "NOT_HOST" };
    if (room.status !== "connecting") return { ok: false, error: "INVALID_STATE" };
    const now = this.now();
    const matchId = randomUUID();
    const endsAt = now + MATCH_DURATION_MS;
    const members = [...room.members.values()].filter((member) => member.entered);
    if (
      members.length < 2 ||
      members.some((member) => member.peerId !== room.hostPeerId && !member.ready)
    ) {
      return { ok: false, error: "NOT_READY" };
    }
    await this.persistence.createMatch({
      id: matchId,
      roomCode: room.code,
      cycle: room.cycle,
      startedAt: now,
      endsAt,
      members,
    });
    room.status = "playing";
    room.connectionExpiresAt = null;
    room.match = { id: matchId, endsAt };
    await this.persistence.updateRoom({
      code: room.code,
      status: room.status,
      cycle: room.cycle,
      now,
    });
    return { ok: true, value: { room, matchId } };
  }

  heartbeat(peerId: PeerId): RoomResult<Room> {
    const room = this.roomForPeer(peerId);
    if (room === undefined) return { ok: false, error: "NOT_IN_ROOM" };
    const member = room.members.get(peerId);
    if (member === undefined) return { ok: false, error: "NOT_IN_ROOM" };
    member.lastHeartbeatAt = this.now();
    return { ok: true, value: room };
  }

  async leave(peerId: PeerId): Promise<RoomEvent[]> {
    const room = this.roomForPeer(peerId);
    if (room === undefined) return [];
    if (room.hostPeerId === peerId) return [await this.close(room, "host-left")];
    room.members.delete(peerId);
    this.peerRooms.delete(peerId);
    return [{ type: "room-state", room: this.state(room), recipients: this.recipients(room) }];
  }

  async closeByHost(peerId: PeerId): Promise<RoomResult<RoomEvent>> {
    const room = this.roomForPeer(peerId);
    if (room === undefined) return { ok: false, error: "NOT_IN_ROOM" };
    if (room.hostPeerId !== peerId) return { ok: false, error: "NOT_HOST" };
    return { ok: true, value: await this.close(room, "closed") };
  }

  /** 房主把指定 guest 踢出房间（仅 lobby；对局中由信令层 MATCH_IN_PROGRESS 门控拒绝）。 */
  kickPeer(hostPeerId: PeerId, targetPeerId: PeerId): RoomResult<Room> {
    const room = this.roomForPeer(hostPeerId);
    if (room === undefined) return { ok: false, error: "NOT_IN_ROOM" };
    if (room.hostPeerId !== hostPeerId) return { ok: false, error: "NOT_HOST" };
    if (room.status !== "lobby") return { ok: false, error: "INVALID_STATE" };
    const target = room.members.get(targetPeerId);
    if (target === undefined || target.isHost) return { ok: false, error: "NOT_IN_ROOM" };
    room.members.delete(targetPeerId);
    this.peerRooms.delete(targetPeerId);
    return { ok: true, value: room };
  }

  async sweep(): Promise<RoomEvent[]> {
    const now = this.now();
    const events: RoomEvent[] = [];
    for (const room of [...this.rooms.values()]) {
      const host = room.members.get(room.hostPeerId);
      if (host === undefined || now - host.lastHeartbeatAt > HEARTBEAT_TIMEOUT_MS) {
        events.push(await this.close(room, "host-timeout"));
        continue;
      }

      let guestChanged = false;
      for (const member of [...room.members.values()]) {
        if (member.isHost || now - member.lastHeartbeatAt <= HEARTBEAT_TIMEOUT_MS) continue;
        room.members.delete(member.peerId);
        this.peerRooms.delete(member.peerId);
        guestChanged = true;
      }
      if (guestChanged) {
        events.push({
          type: "room-state",
          room: this.state(room),
          recipients: this.recipients(room),
        });
      }

      if (room.status === "lobby" && room.lobbyExpiresAt !== null && now >= room.lobbyExpiresAt) {
        events.push(await this.close(room, "idle"));
      } else if (
        room.status === "connecting" &&
        room.connectionExpiresAt !== null &&
        now >= room.connectionExpiresAt
      ) {
        room.status = "lobby";
        room.connectionExpiresAt = null;
        room.lobbyExpiresAt = now + ROOM_IDLE_MS;
        for (const member of room.members.values()) member.ready = false;
        await this.persistence.updateRoom({
          code: room.code,
          status: room.status,
          cycle: room.cycle,
          now,
        });
        events.push({
          type: "room-state",
          room: this.state(room),
          recipients: this.recipients(room),
        });
      } else if (room.status === "playing" && room.match !== null && now >= room.match.endsAt) {
        const matchId = room.match.id;
        const recipients = this.recipients(room);
        await this.persistence.finishMatch({ id: matchId, finishedAt: now, reason: "time-limit" });
        room.status = "lobby";
        room.cycle += 1;
        room.match = null;
        room.lobbyExpiresAt = now + ROOM_IDLE_MS;
        room.connectionExpiresAt = null;
        const hostMember = room.members.get(room.hostPeerId);
        for (const member of room.members.values()) this.peerRooms.delete(member.peerId);
        room.members.clear();
        if (hostMember !== undefined) {
          hostMember.entered = false;
          hostMember.ready = false;
          room.members.set(hostMember.peerId, hostMember);
          this.peerRooms.set(hostMember.peerId, room.code);
        }
        await this.persistence.updateRoom({
          code: room.code,
          status: room.status,
          cycle: room.cycle,
          now,
        });
        events.push({
          type: "match-ended",
          matchId,
          roomCode: room.code,
          rejoinDeadline: room.lobbyExpiresAt,
          recipients,
        });
      }
    }
    return events;
  }

  async shutdown(): Promise<RoomEvent[]> {
    const events: RoomEvent[] = [];
    for (const room of [...this.rooms.values()]) {
      events.push(await this.close(room, "server-shutdown"));
    }
    return events;
  }

  private async close(room: Room, reason: RoomClosedReason): Promise<RoomEvent> {
    const now = this.now();
    const recipients = this.recipients(room);
    if (room.match !== null) {
      const finishReason = reason === "idle" ? "closed" : reason;
      await this.persistence.finishMatch({
        id: room.match.id,
        finishedAt: now,
        reason: finishReason,
      });
    }
    await this.persistence.updateRoom({
      code: room.code,
      status: "closed",
      cycle: room.cycle,
      now,
      closedAt: now,
    });
    this.rooms.delete(room.code);
    for (const member of room.members.values()) this.peerRooms.delete(member.peerId);
    return { type: "room-closed", roomCode: room.code, reason, recipients };
  }
}
