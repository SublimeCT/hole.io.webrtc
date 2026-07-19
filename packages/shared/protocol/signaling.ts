// 协议真源：WebRTC 信令 + 房间管理（客户端 ↔ 信令服务，单一 WSS 通道，JSON）。
// 对应 AGENTS.md §4。纯类型定义（erasable TS），client 与 server 共用，禁止两边各维护一份。
// 信令服务地址 wss://<host>/ws。握手（signal 交换 SDP/ICE）建立 P2P 星型后，WSS 可断（除非走 TURN）。

export type PeerId = string;
export type RoomCode = string;
export type SignalKind = "offer" | "answer" | "ice";

export interface PeerInfo {
  peerId: PeerId;
  playerName: string;
  isHost: boolean;
}

export type RoomClosedReason = "host-left" | "idle" | "closed";

export type RoomErrorCode =
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "NOT_HOST"
  | "EMPTY"
  | "ALREADY_STARTED"
  | "INVALID_CODE";

/** coturn auth-secret 短期凭证，建房/加入时下发，客户端塞进 RTCPeerConnection.iceServers。 */
export interface TurnCredentials {
  /** "{expiryEpoch}:{peerId}"，coturn 按 use-auth-secret 校验。 */
  username: string;
  /** hmac-sha1(secret, username) 的 hex。 */
  credential: string;
  /** 有效期（秒）。 */
  ttl: number;
  /** TURN 服务器地址列表，如 "turn:host:3478?transport=udp"。 */
  uris: readonly string[];
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

/** host 专用：确认与房内所有 guest 的 P2P 连接建立成功后发送，告知 server 房间进入 playing。 */
export interface StartMatchMessage {
  type: "start-match";
}

/** host 专用：主动解散房间。 */
export interface CloseRoomMessage {
  type: "close-room";
}

/** 统一信令消息：server 不解 payload，只按 toPeerId 在同房内路由。 */
export interface SignalOutMessage {
  type: "signal";
  toPeerId: PeerId;
  kind: SignalKind;
  /** 序列化的 SDP 或 RTCIceCandidateInit JSON。 */
  payload: string;
}

export type ClientToServerMessage =
  | CreateRoomMessage
  | JoinRoomMessage
  | StartMatchMessage
  | CloseRoomMessage
  | SignalOutMessage;

// ===== server → client =====

export interface RoomCreatedMessage {
  type: "room-created";
  roomCode: RoomCode;
  peerId: PeerId;
  /** 创建者即 host，isHost 隐含为 true。 */
  turn: TurnCredentials;
}

export interface RoomJoinedMessage {
  type: "room-joined";
  roomCode: RoomCode;
  peerId: PeerId;
  hostPeerId: PeerId;
  /** 加入前已在房内的其他 peer（含 host），供新加入者向其发起 signal。 */
  existingPeers: readonly PeerInfo[];
  turn: TurnCredentials;
}

export interface PeerJoinedMessage {
  type: "peer-joined";
  peer: PeerInfo;
}

export interface PeerLeftMessage {
  type: "peer-left";
  peerId: PeerId;
}

/**
 * 房间关闭，由 server 推送（非任何 peer 发送）：
 * - host-left：lobby 阶段 host 的 WSS 断开。
 * - idle：房间创建后 3 分钟内未 start-match。
 * - closed：host 主动 close-room。
 * 注意：playing 阶段 host 断开不触发房间关闭（游戏进入纯 P2P 自治）。
 */
export interface RoomClosedMessage {
  type: "room-closed";
  reason: RoomClosedReason;
}

/** server 转发的信令：把出站 toPeerId 改写为入站 fromPeerId（发送者）。 */
export interface SignalInMessage {
  type: "signal";
  fromPeerId: PeerId;
  kind: SignalKind;
  payload: string;
}

export interface RoomErrorMessage {
  type: "room-error";
  code: RoomErrorCode;
  message: string;
}

export type ServerToClientMessage =
  | RoomCreatedMessage
  | RoomJoinedMessage
  | PeerJoinedMessage
  | PeerLeftMessage
  | RoomClosedMessage
  | SignalInMessage
  | RoomErrorMessage;
