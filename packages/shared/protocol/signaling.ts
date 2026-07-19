// 协议真源：WebRTC 信令消息（客户端 ↔ 信令服务，WebSocket JSON）。
// 对应 AGENTS.md §4「信令消息」——建连阶段交换 SDP/ICE，DataChannel 建立后信令连接可断开。
// 纯类型定义（erasable TS，无 enum/namespace/参数属性），client 与 server 共用，禁止两边各维护一份。

/** 服务端为每条 WebSocket 连接分配的 peer 标识（crypto.randomUUID）。 */
export type PeerId = string;

/** 房间码，4 位去歧义字母数字（生成逻辑在 server 端，此处仅约束类型）。 */
export type RoomCode = string;

export type RoomErrorCode = "ROOM_NOT_FOUND" | "ROOM_FULL" | "INVALID_CODE";

export interface PeerInfo {
  peerId: PeerId;
  playerName: string;
}

// ===== client → server =====

export interface CreateRoomMessage {
  type: "create-room";
  playerName: string;
}

export interface JoinRoomMessage {
  type: "join-room";
  roomCode: RoomCode;
  playerName: string;
}

/** 客户端发起 SDP offer，请服务端定向转发给 targetPeerId。 */
export interface SdpOfferOutMessage {
  type: "sdp-offer";
  targetPeerId: PeerId;
  sdp: string;
}

export interface SdpAnswerOutMessage {
  type: "sdp-answer";
  targetPeerId: PeerId;
  sdp: string;
}

/** candidate 为序列化后的 RTCIceCandidateInit JSON 串，避免依赖浏览器 webrtc 类型。 */
export interface IceCandidateOutMessage {
  type: "ice-candidate";
  targetPeerId: PeerId;
  candidate: string;
}

export type ClientToServerMessage =
  | CreateRoomMessage
  | JoinRoomMessage
  | SdpOfferOutMessage
  | SdpAnswerOutMessage
  | IceCandidateOutMessage;

// ===== server → client =====

export interface RoomCreatedMessage {
  type: "room-created";
  roomCode: RoomCode;
  peerId: PeerId;
  isHost: true;
}

export interface RoomJoinedMessage {
  type: "room-joined";
  roomCode: RoomCode;
  peerId: PeerId;
  isHost: false;
  hostPeerId: PeerId;
  /** 加入前已在房内的其他 peer（含 host），供新加入者发起 mesh SDP offer。 */
  existingPeers: PeerInfo[];
}

export interface RoomErrorMessage {
  type: "room-error";
  code: RoomErrorCode;
  message: string;
}

export interface PeerJoinedMessage {
  type: "peer-joined";
  peer: PeerInfo;
}

export interface PeerLeftMessage {
  type: "peer-left";
  peerId: PeerId;
}

/** host 掉线 → 房间解散，所有 guest 应回退单机（AGENTS.md §8）。 */
export interface HostDisconnectedMessage {
  type: "host-disconnected";
}

// 转发变体：服务端把出站 SDP/ICE 改写为 fromPeerId 后定向投递给目标 peer。
export interface SdpOfferRelayMessage {
  type: "sdp-offer";
  fromPeerId: PeerId;
  sdp: string;
}

export interface SdpAnswerRelayMessage {
  type: "sdp-answer";
  fromPeerId: PeerId;
  sdp: string;
}

export interface IceCandidateRelayMessage {
  type: "ice-candidate";
  fromPeerId: PeerId;
  candidate: string;
}

export type ServerToClientMessage =
  | RoomCreatedMessage
  | RoomJoinedMessage
  | RoomErrorMessage
  | PeerJoinedMessage
  | PeerLeftMessage
  | HostDisconnectedMessage
  | SdpOfferRelayMessage
  | SdpAnswerRelayMessage
  | IceCandidateRelayMessage;
