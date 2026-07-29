import type {
  PeerId,
  PlayerProfile,
  RoomCode,
  RoomErrorCode,
  ServerToClientMessage,
} from "@hole-io/shared/protocol";
import { multiplayerStore } from "../store/multiplayerStore";
import { SignalingClient, resolveSignalingUrl } from "./signaling";
import { StarConnectionManager, type GameChannelKind } from "./starConnection";

export interface MultiplayerSessionOptions {
  profile: PlayerProfile;
  requestedRoomCode: RoomCode | null;
}

export class MultiplayerSession {
  private readonly signaling: SignalingClient;
  private readonly peerConnections: StarConnectionManager;
  private profile: PlayerProfile;
  private requestedRoomCode: RoomCode | null;
  private disposed = false;
  private gameMessageHandler:
    | ((peerId: PeerId, channel: GameChannelKind, data: string) => void)
    | null = null;
  private pendingReliableGameMessages: Array<{ peerId: PeerId; data: string }> = [];

  constructor(options: MultiplayerSessionOptions) {
    this.profile = options.profile;
    this.requestedRoomCode = options.requestedRoomCode;
    this.signaling = new SignalingClient({
      url: resolveSignalingUrl(),
      onMessage: (message) => void this.handleMessage(message),
      onStatus: (status) => {
        multiplayerStore.getState().setSignalingStatus(status);
        if (status === "error") {
          multiplayerStore.getState().setError("无法连接信令服务，请稍后重试");
        }
      },
      onProtocolError: (message) => multiplayerStore.getState().setError(message),
    });
    this.peerConnections = new StarConnectionManager({
      sendSignal: (message) => {
        if (!this.signaling.send(message)) {
          multiplayerStore.getState().setError("信令连接已断开，无法继续 WebRTC 建连");
        }
      },
      onPeerStatus: (peerId, status) =>
        multiplayerStore.getState().setPeerConnection(peerId, status),
      onPeerConnectionType: (peerId, type) => {
        // 满足「与玩家建立连接后 console.log 连接类型」的需求，并写入 store 供 UI 展示。
        console.log(`[WebRTC] peer=${peerId} type=${type}`);
        multiplayerStore.getState().setPeerConnectionType(peerId, type);
      },
      onChannelMessage: (peerId, channel, data) => {
        if (this.gameMessageHandler !== null) {
          this.gameMessageHandler(peerId, channel, data);
        } else if (channel === "reliable") {
          this.pendingReliableGameMessages.push({ peerId, data });
        }
      },
      onHostReady: () => {
        this.signaling.send({ type: "start-match" });
      },
      onError: (message) => multiplayerStore.getState().setError(message),
    });
  }

  start(): void {
    multiplayerStore.getState().reset();
    multiplayerStore.getState().setSignalingStatus("connecting");
    this.signaling.connect();
  }

  setReady(ready: boolean): void {
    this.signaling.send({ type: "set-ready", ready });
  }

  beginConnection(): void {
    this.signaling.send({ type: "begin-connection" });
  }

  /** 房主把指定 guest 踢出房间（仅 lobby 有效）。 */
  kickPeer(peerId: PeerId): void {
    this.signaling.send({ type: "kick-peer", peerId });
  }

  /** OnlineGameDriver 注册游戏消息回调（host 收 InputPacket，guest 收快照/事件/checkpoint）。 */
  setGameMessageHandler(
    handler: ((peerId: PeerId, channel: GameChannelKind, data: string) => void) | null,
  ): void {
    this.gameMessageHandler = handler;
    if (handler === null || this.pendingReliableGameMessages.length === 0) return;
    const pending = this.pendingReliableGameMessages.splice(0);
    for (const message of pending) handler(message.peerId, "reliable", message.data);
  }

  /** 在指定 DataChannel 上向 peerId 发送已编码文本。 */
  sendGameData(peerId: PeerId, channel: GameChannelKind, data: string): boolean {
    return this.peerConnections.send(peerId, channel, data);
  }

  /** 两条 DataChannel 都 open 的对端列表。 */
  getGamePeerIds(): PeerId[] {
    return this.peerConnections.getConnectedPeerIds();
  }

  get isHost(): boolean {
    return this.peerConnections.hostMode;
  }

  updateProfile(profile: PlayerProfile): void {
    this.profile = profile;
    if (multiplayerStore.getState().room === null && this.requestedRoomCode !== null) {
      this.signaling.send({
        type: "enter-room",
        roomCode: this.requestedRoomCode,
        profile,
      });
      return;
    }
    this.signaling.send({ type: "update-profile", profile });
  }

  leave(): void {
    this.dispose(true);
  }

  dispose(sendLeave: boolean): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pendingReliableGameMessages = [];
    this.peerConnections.close();
    this.signaling.close(sendLeave);
  }

  private async handleMessage(message: ServerToClientMessage): Promise<void> {
    if (this.disposed) return;
    switch (message.type) {
      case "connected":
        multiplayerStore.getState().setIdentity(message.peerId);
        if (this.requestedRoomCode === null) {
          this.signaling.send({ type: "create-room", profile: this.profile });
        } else {
          this.signaling.send({
            type: "enter-room",
            roomCode: this.requestedRoomCode,
            profile: this.profile,
          });
        }
        return;
      case "room-created":
      case "room-entered":
        this.requestedRoomCode = message.room.roomCode;
        multiplayerStore.getState().setRoom(message.room, message.turn);
        await this.syncPeerConnections(message.room, message.turn);
        return;
      case "room-state":
        multiplayerStore.getState().setRoom(message.room);
        await this.syncPeerConnections(message.room);
        return;
      case "connection-started": {
        multiplayerStore.getState().setRoom(message.room);
        await this.syncPeerConnections(message.room);
        return;
      }
      case "signal-offer":
      case "signal-answer":
      case "signal-ice":
        await this.peerConnections.handle(message);
        return;
      case "match-started":
        multiplayerStore.getState().setRoom(message.room);
        multiplayerStore.getState().setMatch(message.matchId);
        return;
      case "match-ended":
        this.peerConnections.close();
        multiplayerStore.getState().clearPeerConnections();
        multiplayerStore.getState().setMatch(null);
        this.signaling.send({
          type: "enter-room",
          roomCode: message.roomCode,
          profile: this.profile,
        });
        return;
      case "room-closed":
        this.peerConnections.close();
        this.signaling.close(false); // 停止心跳
        multiplayerStore.getState().clearRoom();
        multiplayerStore.getState().setError(roomClosedMessage(message.reason));
        multiplayerStore.getState().setTermination(message.reason);
        return;
      case "kicked":
        // 被房主移出：销毁本地会话（不重发 leave-room，服务端已移除），回主页。
        this.dispose(false);
        multiplayerStore.getState().clearRoom();
        multiplayerStore.getState().setError("你已被房主移出房间");
        multiplayerStore.getState().setTermination("kicked");
        return;
      case "heartbeat-ack":
        multiplayerStore.getState().setLatency(Math.max(0, Date.now() - message.clientTime));
        return;
      case "room-error":
        multiplayerStore.getState().setError(roomErrorMessage(message.code));
    }
  }

  private async syncPeerConnections(
    room: Extract<ServerToClientMessage, { type: "room-state" }>["room"],
    turnOverride?: Extract<ServerToClientMessage, { type: "room-entered" }>["turn"],
  ): Promise<void> {
    const state = multiplayerStore.getState();
    const turn = turnOverride ?? state.turn;
    if (state.peerId === null || turn === null) {
      state.setError("缺少 WebRTC 身份或 TURN 配置");
      return;
    }
    try {
      await this.peerConnections.sync(room, state.peerId, turn);
    } catch (error: unknown) {
      state.setError(error instanceof Error ? error.message : "WebRTC 连接测试失败");
    }
  }
}

function roomErrorMessage(code: RoomErrorCode): string {
  const messages: Record<RoomErrorCode, string> = {
    INVALID_MESSAGE: "发送的房间消息格式无效",
    ROOM_UNAVAILABLE: "房间不存在、已满或当前无法加入",
    ROOM_FULL: "房间人数已满",
    PLAYER_NAME_TAKEN: "该玩家名称已被使用，请更换名称",
    ROOM_LIMIT_REACHED: "服务器房间数量已达到上限",
    ALREADY_IN_ROOM: "你已经在另一个房间中",
    NOT_IN_ROOM: "你当前不在房间中",
    NOT_HOST: "只有房主可以执行此操作",
    NOT_READY: "需要所有已进入玩家先准备",
    INVALID_STATE: "当前房间阶段不允许此操作",
    MATCH_IN_PROGRESS: "游戏进行中只能发送心跳",
    SIGNAL_NOT_ALLOWED: "此 WebRTC 信令目标不被允许",
    RATE_LIMITED: "操作过于频繁，请稍后重试",
    ACCESS_BLOCKED: "当前网络地址已被服务器封禁",
    INTERNAL_ERROR: "服务器内部错误，请稍后重试",
  };
  return messages[code];
}

function roomClosedMessage(
  reason: "idle" | "host-timeout" | "host-left" | "closed" | "server-shutdown",
): string {
  if (reason === "idle") return "房间等待超时，已自动解散";
  if (reason === "host-timeout") return "房主连接超时，游戏已结束";
  if (reason === "host-left") return "房主已离开，房间已解散";
  if (reason === "server-shutdown") return "服务器正在维护，房间已关闭";
  return "房间已由房主关闭";
}

export function createPlayerProfile(input: {
  playerName: string;
  color: string;
  language: PlayerProfile["language"];
  platform: string;
}): PlayerProfile {
  return {
    playerName: input.playerName.normalize("NFKC").trim(),
    color: input.color.toUpperCase(),
    language: input.language,
    platform: input.platform.normalize("NFKC").trim(),
  };
}
