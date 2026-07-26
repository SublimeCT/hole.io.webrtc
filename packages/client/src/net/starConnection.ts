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

interface PeerLink {
  connection: RTCPeerConnection;
  reliable: RTCDataChannel | null;
  unreliable: RTCDataChannel | null;
  pendingCandidates: RTCIceCandidateInit[];
}

export interface StarConnectionOptions {
  sendSignal(message: ClientToServerMessage): void;
  onPeerStatus(peerId: PeerId, status: PeerConnectionStatus): void;
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
  private hostReadyEmitted = false;

  constructor(options: StarConnectionOptions) {
    this.options = options;
  }

  async begin(room: RoomState, localPeerId: PeerId, turn: TurnCredentials): Promise<void> {
    this.close();
    this.turn = turn;
    const host = room.peers.find((peer) => peer.isHost && peer.entered);
    if (host === undefined) throw new Error("房间缺少已进入的房主");
    this.hostPeerId = host.peerId;
    this.isHost = host.peerId === localPeerId;

    if (!this.isHost) return;
    this.expectedGuests = new Set(
      room.peers.filter((peer) => peer.entered && !peer.isHost).map((peer) => peer.peerId),
    );
    for (const guestPeerId of this.expectedGuests) {
      await this.createOffer(guestPeerId);
    }
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
      if (state === "failed" || state === "disconnected") {
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

  private attachChannel(link: PeerLink, peerId: PeerId, channel: RTCDataChannel): void {
    channel.binaryType = "arraybuffer";
    channel.addEventListener("open", () => this.checkReady(link, peerId));
    channel.addEventListener("close", () => this.options.onPeerStatus(peerId, "closed"));
    channel.addEventListener("error", () => this.options.onPeerStatus(peerId, "failed"));
  }

  private checkReady(link: PeerLink, peerId: PeerId): void {
    if (link.reliable?.readyState !== "open" || link.unreliable?.readyState !== "open") return;
    this.options.onPeerStatus(peerId, "connected");
    if (!this.isHost || this.hostReadyEmitted || this.expectedGuests.size === 0) return;
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
