import type { PeerId, PeerInfo, RoomCode } from "@hole-io/shared/protocol";
import { generateRoomCode } from "./roomCode.js";

/** 房间内成员（不含 ws——ws 由 signalingPlugin 单独管理，保持本模块纯逻辑、零运行时依赖）。 */
export interface RoomPeer {
  peerId: PeerId;
  playerName: string;
  isHost: boolean;
}

export type RoomStatus = "lobby" | "playing" | "closed";

export interface Room {
  code: RoomCode;
  hostPeerId: PeerId;
  status: RoomStatus;
  peers: Map<PeerId, RoomPeer>;
  createdAt: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

export type JoinRoomResult =
  | { ok: true; room: Room; existingPeers: PeerInfo[] }
  | { ok: false; errorCode: "ROOM_NOT_FOUND" | "ROOM_FULL" };

export type StartMatchResult =
  | { ok: true }
  | { ok: false; errorCode: "NOT_HOST" | "EMPTY" | "ALREADY_STARTED" };

export type DetachPeerResult =
  | { outcome: "guest-left"; remaining: PeerInfo[] }
  | { outcome: "host-left-lobby"; remaining: PeerInfo[] }
  | { outcome: "host-left-playing" }
  | { outcome: "no-op" };

export interface RoomStoreOptions {
  maxPeers: number;
  roomIdleMs: number;
  now: () => number;
}

/**
 * 内存态房间状态机：lobby → playing → closed。
 * - lobby：createRoom 起作用，挂 idleTimer（ROOM_IDLE_MS 内未 start-match 则触发 idleHandler）。
 * - playing：startMatch 后，清 idleTimer；host 断开不解散（游戏进入 P2P 自治）。
 * - closed：forceClose/closeRoom，roomId 销毁。
 * host-left-lobby / host-left-playing 是内部 outcome，由 signalingPlugin 翻译成对外的 room-closed{reason}。
 */
export class RoomStore {
  private readonly rooms = new Map<RoomCode, Room>();
  private readonly options: RoomStoreOptions;
  private idleHandler: ((code: RoomCode) => void) | null = null;

  constructor(options: RoomStoreOptions) {
    this.options = options;
  }

  setIdleHandler(handler: (code: RoomCode) => void): void {
    this.idleHandler = handler;
  }

  get size(): number {
    return this.rooms.size;
  }

  private peerInfos(room: Room): PeerInfo[] {
    return [...room.peers.values()].map((p) => ({
      peerId: p.peerId,
      playerName: p.playerName,
      isHost: p.isHost,
    }));
  }

  roomOfPeer(peerId: PeerId): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.peers.has(peerId)) return room;
    }
    return undefined;
  }

  createRoom(host: { peerId: PeerId; playerName: string }): Room {
    const code = generateRoomCode(new Set(this.rooms.keys()));
    const room: Room = {
      code,
      hostPeerId: host.peerId,
      status: "lobby",
      peers: new Map([
        [host.peerId, { peerId: host.peerId, playerName: host.playerName, isHost: true }],
      ]),
      createdAt: this.options.now(),
      idleTimer: null,
    };
    room.idleTimer = this.startIdleTimer(code);
    this.rooms.set(code, room);
    return room;
  }

  joinRoom(code: RoomCode, peer: { peerId: PeerId; playerName: string }): JoinRoomResult {
    const room = this.rooms.get(code);
    if (room === undefined) return { ok: false, errorCode: "ROOM_NOT_FOUND" };
    if (room.status !== "lobby") return { ok: false, errorCode: "ROOM_FULL" };
    if (room.peers.size >= this.options.maxPeers) return { ok: false, errorCode: "ROOM_FULL" };
    const existingPeers = this.peerInfos(room);
    room.peers.set(peer.peerId, {
      peerId: peer.peerId,
      playerName: peer.playerName,
      isHost: false,
    });
    return { ok: true, room, existingPeers };
  }

  startMatch(code: RoomCode, peerId: PeerId): StartMatchResult {
    const room = this.rooms.get(code);
    if (room === undefined || room.hostPeerId !== peerId) {
      return { ok: false, errorCode: "NOT_HOST" };
    }
    if (room.status !== "lobby") return { ok: false, errorCode: "ALREADY_STARTED" };
    if (room.peers.size < 2) return { ok: false, errorCode: "EMPTY" };
    room.status = "playing";
    if (room.idleTimer !== null) {
      clearTimeout(room.idleTimer);
      room.idleTimer = null;
    }
    return { ok: true };
  }

  /** host 主动解散；返回需通知的房内成员（含 host，调用方自行排除 host）。非 host 返回 null。 */
  closeRoom(code: RoomCode, byPeerId: PeerId): PeerInfo[] | null {
    const room = this.rooms.get(code);
    if (room === undefined || room.hostPeerId !== byPeerId) return null;
    return this.forceClose(code);
  }

  /** 强制关闭房间（idle 超时 / host 主动 / lobby 阶段 host 断开），返回房内成员。 */
  forceClose(code: RoomCode): PeerInfo[] | null {
    const room = this.rooms.get(code);
    if (room === undefined) return null;
    if (room.idleTimer !== null) {
      clearTimeout(room.idleTimer);
      room.idleTimer = null;
    }
    room.status = "closed";
    const members = this.peerInfos(room);
    this.rooms.delete(code);
    return members;
  }

  /** 成员 WSS 断开时调用，返回需 signalingPlugin 执行的副作用。 */
  detachPeer(peerId: PeerId): DetachPeerResult {
    const room = this.roomOfPeer(peerId);
    if (room === undefined) return { outcome: "no-op" };
    const wasHost = room.hostPeerId === peerId;

    // playing 阶段 host 断：不解散（游戏自治），保留房间记录。
    if (room.status === "playing" && wasHost) {
      return { outcome: "host-left-playing" };
    }

    room.peers.delete(peerId);

    if (room.status === "playing") {
      if (room.peers.size === 0) this.forceClose(room.code);
      return { outcome: "guest-left", remaining: this.peerInfos(room) };
    }

    // lobby 阶段 host 断：解散房间，通知剩余 guest。
    if (wasHost) {
      const members = this.forceClose(room.code);
      return { outcome: "host-left-lobby", remaining: members ?? [] };
    }

    return { outcome: "guest-left", remaining: this.peerInfos(room) };
  }

  private startIdleTimer(code: RoomCode): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      this.idleHandler?.(code);
    }, this.options.roomIdleMs);
  }
}
