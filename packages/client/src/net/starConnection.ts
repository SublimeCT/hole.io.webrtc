import type {
  ClientToServerMessage,
  PeerId,
  RoomState,
  ServerToClientMessage,
  TurnCredentials,
} from "@hole-io/shared/protocol";
import type { PeerConnectionStatus } from "../store/multiplayerStore";

const RELIABLE_CHANNEL = "game-reliable-v1";
const UNRELIABLE_CHANNEL = "game-unreliable-v1";
/** unreliable DataChannel 发送缓冲高水位：超过则丢弃新包（拥塞让路，旧快照本就该被新快照覆盖）。 */
const MAX_DC_BUFFERED_BYTES = 256 * 1024;

export type GameChannelKind = "reliable" | "unreliable";

/**
 * 通过 RTCPeerConnection.getStats() 读取当前选中 candidate-pair 的本地 candidate 类型，
 * 判断本端到对端走的是直连/STUN 打洞（host/srflx/prflx → direct）还是 TURN 中继（relay）。
 * ICE 可能后续切换路径，故调用方在 connected 后仍可再次调用复检。
 */
async function detectIceTransportType(
  connection: RTCPeerConnection,
): Promise<"direct" | "relay" | null> {
  try {
    const stats = await connection.getStats();
    let localCandidateId: string | null = null;
    for (const report of stats.values()) {
      if (report.type !== "candidate-pair") continue;
      const pair = report as RTCIceCandidatePairStats;
      if (pair.nominated || pair.state === "succeeded") {
        localCandidateId = pair.localCandidateId ?? null;
        if (localCandidateId !== null) break;
      }
    }
    if (localCandidateId === null) return null;
    for (const report of stats.values()) {
      if (report.id !== localCandidateId || report.type !== "local-candidate") continue;
      // RTCIceCandidateStats 的 candidateType 字段在部分 TS DOM lib 版本里类型缺失，按最小形状读取。
      const candidateType = (report as { candidateType?: string }).candidateType;
      return candidateType === "relay" ? "relay" : "direct";
    }
    return null;
  } catch {
    return null;
  }
}

interface PeerLink {
  connection: RTCPeerConnection;
  reliable: RTCDataChannel | null;
  unreliable: RTCDataChannel | null;
  pendingCandidates: RTCIceCandidateInit[];
}

export interface StarConnectionOptions {
  sendSignal(message: ClientToServerMessage): void;
  onPeerStatus(peerId: PeerId, status: PeerConnectionStatus): void;
  /** WebRTC 连通后检测到的传输类型（direct = host/srflx；relay = TURN）。可多次回调（ICE 可能切换）。 */
  onPeerConnectionType(peerId: PeerId, type: "direct" | "relay"): void;
  /** DataChannel 收到文本消息时上抛（按 channel label 区分 reliable/unreliable）。 */
  onChannelMessage(peerId: PeerId, channel: GameChannelKind, data: string): void;
  onHostReady(): void;
  onError(message: string): void;
}

export class StarConnectionManager {
  private readonly options: StarConnectionOptions;
  private readonly links = new Map<PeerId, PeerLink>();
  private expectedGuests = new Set<PeerId>();
  private hostPeerId: PeerId | null = null;
  private turn: TurnCredentials | null = null;
  private isHost = false;
  private mayStartMatch = false;
  private hostReadyEmitted = false;

  constructor(options: StarConnectionOptions) {
    this.options = options;
  }

  async sync(room: RoomState, localPeerId: PeerId, turn: TurnCredentials): Promise<void> {
    this.turn = turn;
    const host = room.peers.find((peer) => peer.isHost);
    if (host === undefined) throw new Error("房间缺少房主");
    // 对局刚结束时服务端会把房主置为 entered=false（见 roomService sweep），各客户端随后才各自
    // 重新 enter-room。若本端先于房主重新 enter 而收到 room-state，此时房主尚未 entered，应静默
    // 等待房主重新 enter 后的 room-state 再次触发 sync，而不是抛出假错误阻断星型连接重建。
    if (!host.entered) return;
    const hostChanged = this.hostPeerId !== null && this.hostPeerId !== host.peerId;
    const hostModeChanged =
      this.hostPeerId !== null && this.isHost !== (host.peerId === localPeerId);
    if (hostChanged || hostModeChanged) this.close();
    this.hostPeerId = host.peerId;
    this.isHost = host.peerId === localPeerId;
    this.mayStartMatch = room.status === "connecting";
    if (room.status === "lobby") this.hostReadyEmitted = false;

    const nextGuests = new Set(
      room.peers.filter((peer) => peer.entered && !peer.isHost).map((peer) => peer.peerId),
    );
    const expectedLinks = this.isHost ? nextGuests : new Set([host.peerId]);
    for (const [peerId, link] of this.links) {
      if (expectedLinks.has(peerId)) continue;
      link.reliable?.close();
      link.unreliable?.close();
      link.connection.close();
      this.links.delete(peerId);
      this.options.onPeerStatus(peerId, "closed");
    }
    this.expectedGuests = nextGuests;

    if (this.isHost) {
      for (const guestPeerId of this.expectedGuests) {
        if (!this.links.has(guestPeerId)) await this.createOffer(guestPeerId);
      }
    }
    this.checkHostReady();
  }

  async handle(message: ServerToClientMessage): Promise<void> {
    try {
      if (message.type === "signal-offer") {
        await this.acceptOffer(message.fromPeerId, message.description.sdp);
      } else if (message.type === "signal-answer") {
        await this.acceptAnswer(message.fromPeerId, message.description.sdp);
      } else if (message.type === "signal-ice") {
        await this.acceptCandidate(message.fromPeerId, message.candidate);
      }
    } catch (error: unknown) {
      this.options.onError(error instanceof Error ? error.message : "WebRTC 信令处理失败");
    }
  }

  close(): void {
    for (const [peerId, link] of this.links) {
      link.reliable?.close();
      link.unreliable?.close();
      link.connection.close();
      this.options.onPeerStatus(peerId, "closed");
    }
    this.links.clear();
    this.expectedGuests.clear();
    this.hostPeerId = null;
    this.turn = null;
    this.isHost = false;
    this.mayStartMatch = false;
    this.hostReadyEmitted = false;
  }

  private async createOffer(peerId: PeerId): Promise<void> {
    const link = this.ensureLink(peerId);
    link.reliable = this.createChannel(link, peerId, RELIABLE_CHANNEL);
    link.unreliable = this.createChannel(link, peerId, UNRELIABLE_CHANNEL, {
      ordered: false,
      maxRetransmits: 0,
    });
    const offer = await link.connection.createOffer();
    await link.connection.setLocalDescription(offer);
    if (!offer.sdp) throw new Error("浏览器未生成 WebRTC offer SDP");
    this.options.sendSignal({
      type: "signal-offer",
      toPeerId: peerId,
      description: { sdp: offer.sdp },
    });
  }

  private async acceptOffer(peerId: PeerId, sdp: string): Promise<void> {
    if (this.isHost || peerId !== this.hostPeerId) {
      throw new Error("拒绝非房主发送的 WebRTC offer");
    }
    const link = this.ensureLink(peerId);
    await link.connection.setRemoteDescription({ type: "offer", sdp });
    await this.flushCandidates(link);
    const answer = await link.connection.createAnswer();
    await link.connection.setLocalDescription(answer);
    if (!answer.sdp) throw new Error("浏览器未生成 WebRTC answer SDP");
    this.options.sendSignal({
      type: "signal-answer",
      toPeerId: peerId,
      description: { sdp: answer.sdp },
    });
  }

  private async acceptAnswer(peerId: PeerId, sdp: string): Promise<void> {
    if (!this.isHost || !this.expectedGuests.has(peerId)) {
      throw new Error("拒绝非预期 guest 发送的 WebRTC answer");
    }
    const link = this.links.get(peerId);
    if (link === undefined) throw new Error("WebRTC answer 没有对应的 offer");
    await link.connection.setRemoteDescription({ type: "answer", sdp });
    await this.flushCandidates(link);
  }

  private async acceptCandidate(peerId: PeerId, candidate: RTCIceCandidateInit): Promise<void> {
    const allowed = this.isHost ? this.expectedGuests.has(peerId) : peerId === this.hostPeerId;
    if (!allowed) throw new Error("拒绝非星型拓扑成员发送的 ICE candidate");
    const link = this.ensureLink(peerId);
    if (link.connection.remoteDescription === null) {
      link.pendingCandidates.push(candidate);
      return;
    }
    await link.connection.addIceCandidate(candidate);
  }

  private ensureLink(peerId: PeerId): PeerLink {
    const existing = this.links.get(peerId);
    if (existing !== undefined) return existing;
    if (this.turn === null) throw new Error("缺少 TURN 配置");

    const connection = new RTCPeerConnection({
      iceServers: [
        { urls: this.turn.stunUris },
        {
          urls: this.turn.uris,
          username: this.turn.username,
          credential: this.turn.credential,
        },
      ],
      bundlePolicy: "max-bundle",
    });
    const link: PeerLink = {
      connection,
      reliable: null,
      unreliable: null,
      pendingCandidates: [],
    };
    this.links.set(peerId, link);
    this.options.onPeerStatus(peerId, "connecting");

    connection.addEventListener("icecandidate", (event) => {
      if (event.candidate === null) return;
      const candidate = event.candidate.toJSON();
      this.options.sendSignal({
        type: "signal-ice",
        toPeerId: peerId,
        candidate: {
          candidate: candidate.candidate ?? "",
          sdpMid: candidate.sdpMid ?? null,
          sdpMLineIndex: candidate.sdpMLineIndex ?? null,
          usernameFragment: candidate.usernameFragment ?? null,
        },
      });
    });
    connection.addEventListener("connectionstatechange", () => {
      const state = connection.connectionState;
      if (state === "connected") {
        this.checkReady(link, peerId);
        this.reportConnectionType(peerId, connection);
      } else if (state === "failed" || state === "disconnected") {
        this.options.onPeerStatus(peerId, "failed");
      } else if (state === "closed") {
        this.options.onPeerStatus(peerId, "closed");
      }
    });
    connection.addEventListener("datachannel", (event) => {
      if (event.channel.label === RELIABLE_CHANNEL) {
        link.reliable = event.channel;
        this.attachChannel(link, peerId, event.channel);
      } else if (event.channel.label === UNRELIABLE_CHANNEL) {
        link.unreliable = event.channel;
        this.attachChannel(link, peerId, event.channel);
      } else {
        event.channel.close();
      }
    });
    return link;
  }

  private createChannel(
    link: PeerLink,
    peerId: PeerId,
    label: string,
    options?: RTCDataChannelInit,
  ): RTCDataChannel {
    const channel = link.connection.createDataChannel(label, options);
    this.attachChannel(link, peerId, channel);
    return channel;
  }

  private channelKind(label: string): GameChannelKind | null {
    if (label === RELIABLE_CHANNEL) return "reliable";
    if (label === UNRELIABLE_CHANNEL) return "unreliable";
    return null;
  }

  private attachChannel(link: PeerLink, peerId: PeerId, channel: RTCDataChannel): void {
    channel.binaryType = "arraybuffer";
    channel.addEventListener("open", () => this.checkReady(link, peerId));
    channel.addEventListener("close", () => this.options.onPeerStatus(peerId, "closed"));
    channel.addEventListener("error", () => this.options.onPeerStatus(peerId, "failed"));
    channel.addEventListener("message", (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      const kind = this.channelKind(channel.label);
      if (kind !== null) this.options.onChannelMessage(peerId, kind, event.data);
    });
  }

  /**
   * 在指定 channel 上向 peerId 发送文本。unreliable 拥塞时丢弃（旧快照被新快照覆盖）；
   * reliable 由浏览器排队保证到达。返回 false 表示 peer 不存在/通道未开/被丢弃。
   */
  send(peerId: PeerId, channel: GameChannelKind, data: string): boolean {
    const link = this.links.get(peerId);
    if (link === undefined) return false;
    const dc = channel === "reliable" ? link.reliable : link.unreliable;
    if (dc === null || dc.readyState !== "open") return false;
    if (channel === "unreliable" && dc.bufferedAmount > MAX_DC_BUFFERED_BYTES) return false;
    dc.send(data);
    return true;
  }

  /** 当前两条 DataChannel 都已 open 的对端（host 端 = 全部已连 guests，guest 端 = [host]）。 */
  getConnectedPeerIds(): PeerId[] {
    const ids: PeerId[] = [];
    for (const [peerId, link] of this.links) {
      if (link.reliable?.readyState === "open" && link.unreliable?.readyState === "open") {
        ids.push(peerId);
      }
    }
    return ids;
  }

  get hostMode(): boolean {
    return this.isHost;
  }

  private checkReady(link: PeerLink, peerId: PeerId): void {
    if (link.reliable?.readyState !== "open" || link.unreliable?.readyState !== "open") return;
    this.options.onPeerStatus(peerId, "connected");
    this.checkHostReady();
  }

  /** 连通后探测并上报 ICE 传输类型；getStats 异步，失败静默（不影响连接本身）。 */
  private reportConnectionType(peerId: PeerId, connection: RTCPeerConnection): void {
    void detectIceTransportType(connection).then((type) => {
      if (type !== null) this.options.onPeerConnectionType(peerId, type);
    });
  }

  private checkHostReady(): void {
    if (
      !this.isHost ||
      !this.mayStartMatch ||
      this.hostReadyEmitted ||
      this.expectedGuests.size === 0
    ) {
      return;
    }
    for (const expectedPeerId of this.expectedGuests) {
      const expected = this.links.get(expectedPeerId);
      if (expected?.reliable?.readyState !== "open" || expected.unreliable?.readyState !== "open") {
        return;
      }
    }
    this.hostReadyEmitted = true;
    this.options.onHostReady();
  }

  private async flushCandidates(link: PeerLink): Promise<void> {
    const candidates = link.pendingCandidates.splice(0);
    for (const candidate of candidates) await link.connection.addIceCandidate(candidate);
  }
}
