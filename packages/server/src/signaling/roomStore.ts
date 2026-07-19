import type { PeerId, RoomCode, PeerInfo } from "@hole-io/shared/protocol";
import { generateRoomCode } from "./roomCode.js";

/**
 * roomStore 只依赖「能 send 的 socket」抽象，不耦合 fastify/ws，
 * 保持为纯内存逻辑、零运行时依赖、易单测。
 */
export interface SendableSocket {
  send(data: string): void;
  readonly readyState: number;
}

export interface RoomPeer {
  peerId: PeerId;
  playerName: string;
  ws: SendableSocket;
}

export interface Room {
  code: RoomCode;
  hostPeerId: PeerId;
  peers: Map<PeerId, RoomPeer>;
  createdAt: number;
}

export type JoinRoomResult =
  | { ok: true; room: Room; existingPeers: PeerInfo[] }
  | { ok: false; errorCode: "ROOM_NOT_FOUND" | "ROOM_FULL" };

export type RemovePeerResult =
  | { outcome: "not-in-room" }
  | { outcome: "room-empty" }
  | { outcome: "guest-left"; remainingPeers: RoomPeer[] }
  | { outcome: "host-left"; remainingPeers: RoomPeer[] };

/** 内存态房间表。信令是临时连接（AGENTS.md §4），不做持久化。 */
export class RoomStore {
  private readonly rooms = new Map<RoomCode, Room>();
  private readonly peerRoom = new Map<PeerId, RoomCode>();

  createRoom(host: { peerId: PeerId; playerName: string; ws: SendableSocket }): Room {
    const code = generateRoomCode(new Set(this.rooms.keys()));
    const room: Room = {
      code,
      hostPeerId: host.peerId,
      peers: new Map([
        [host.peerId, { peerId: host.peerId, playerName: host.playerName, ws: host.ws }],
      ]),
      createdAt: Date.now(),
    };
    this.rooms.set(code, room);
    this.peerRoom.set(host.peerId, code);
    return room;
  }

  joinRoom(
    code: RoomCode,
    peer: { peerId: PeerId; playerName: string; ws: SendableSocket },
    maxPeers: number,
  ): JoinRoomResult {
    const room = this.rooms.get(code);
    if (room === undefined) return { ok: false, errorCode: "ROOM_NOT_FOUND" };
    if (room.peers.size >= maxPeers) return { ok: false, errorCode: "ROOM_FULL" };
    const existingPeers: PeerInfo[] = [...room.peers.values()].map((p) => ({
      peerId: p.peerId,
      playerName: p.playerName,
    }));
    room.peers.set(peer.peerId, {
      peerId: peer.peerId,
      playerName: peer.playerName,
      ws: peer.ws,
    });
    this.peerRoom.set(peer.peerId, code);
    return { ok: true, room, existingPeers };
  }

  getRoom(code: RoomCode): Room | undefined {
    return this.rooms.get(code);
  }

  /** 当前活跃房间数（用于全局房间数上限检查）。 */
  get size(): number {
    return this.rooms.size;
  }

  roomOf(peerId: PeerId): Room | undefined {
    const code = this.peerRoom.get(peerId);
    if (code === undefined) return undefined;
    return this.rooms.get(code);
  }

  /**
   * 移除一个 peer，返回需要调用方执行的副作用：
   * - not-in-room：该 peer 不在任何房间，无需广播。
   * - room-empty：最后一人离开，房间自然消失，无需广播。
   * - guest-left：普通成员离开，向 remainingPeers 广播 peer-left。
   * - host-left：host 离开，房间解散，向 remainingPeers 广播 host-disconnected（AGENTS.md §8）。
   */
  removePeer(peerId: PeerId): RemovePeerResult {
    const code = this.peerRoom.get(peerId);
    this.peerRoom.delete(peerId);
    if (code === undefined) return { outcome: "not-in-room" };
    const room = this.rooms.get(code);
    if (room === undefined) return { outcome: "not-in-room" };

    const wasHost = room.hostPeerId === peerId;
    room.peers.delete(peerId);
    const remainingPeers = [...room.peers.values()];

    if (remainingPeers.length === 0) {
      this.rooms.delete(code);
      return { outcome: "room-empty" };
    }
    if (wasHost) {
      this.rooms.delete(code);
      return { outcome: "host-left", remainingPeers };
    }
    return { outcome: "guest-left", remainingPeers };
  }
}
