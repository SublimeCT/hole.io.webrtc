import {
  isServerToClientMessage,
  type ClientToServerMessage,
  type ServerToClientMessage,
} from "@hole-io/shared/protocol";

export interface SignalingClientOptions {
  url: string;
  onMessage(message: ServerToClientMessage): void;
  onStatus(status: "connecting" | "open" | "closed" | "error"): void;
  onProtocolError(message: string): void;
}

export class SignalingClient {
  private readonly options: SignalingClientOptions;
  private socket: WebSocket | null = null;
  private heartbeatTimer: number | null = null;
  private heartbeatIntervalMs = 4_000;
  private explicitlyClosed = false;
  private connectAttempt = 0;

  constructor(options: SignalingClientOptions) {
    this.options = options;
  }

  connect(): void {
    if (this.socket !== null) return;
    this.explicitlyClosed = false;
    this.options.onStatus("connecting");
    const attempt = ++this.connectAttempt;
    void this.checkAccessAndConnect(attempt);
  }

  private async checkAccessAndConnect(attempt: number): Promise<void> {
    try {
      const accessUrl = new URL(this.options.url);
      accessUrl.protocol = accessUrl.protocol === "wss:" ? "https:" : "http:";
      accessUrl.pathname = "/access-status";
      accessUrl.search = "";
      accessUrl.hash = "";
      const response = await fetch(accessUrl, { headers: { accept: "application/json" } });
      if (response.status === 403) {
        const payload: unknown = await response.json().catch(() => null);
        this.options.onStatus("error");
        this.options.onProtocolError(accessBlockedMessage(payload));
        return;
      }
    } catch {
      // Older deployments may not expose the preflight endpoint; WebSocket remains the fallback.
    }
    if (this.explicitlyClosed || attempt !== this.connectAttempt) return;
    const socket = new WebSocket(this.options.url);
    this.socket = socket;

    socket.addEventListener("open", () => this.options.onStatus("open"));
    socket.addEventListener("message", (event) => this.handleMessage(event.data));
    socket.addEventListener("error", () => this.options.onStatus("error"));
    socket.addEventListener("close", () => {
      this.stopHeartbeat();
      this.socket = null;
      this.options.onStatus(this.explicitlyClosed ? "closed" : "error");
    });
  }

  send(message: ClientToServerMessage): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  close(sendLeave: boolean): void {
    this.explicitlyClosed = true;
    this.connectAttempt += 1;
    this.stopHeartbeat();
    const socket = this.socket;
    if (socket === null) return;
    if (sendLeave && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "leave-room" } satisfies ClientToServerMessage));
      window.setTimeout(() => socket.close(1000, "leaving room"), 50);
      return;
    }
    socket.close(1000, "client closed");
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== "string") {
      this.options.onProtocolError("信令服务返回了非文本消息");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.options.onProtocolError("信令服务返回了无效 JSON");
      return;
    }
    if (!isServerToClientMessage(parsed)) {
      this.options.onProtocolError("信令服务返回了不符合共享协议的消息");
      return;
    }
    if (parsed.type === "connected") {
      this.heartbeatIntervalMs = parsed.heartbeatIntervalMs;
      this.startHeartbeat();
    }
    this.options.onMessage(parsed);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const heartbeat = (): void => {
      this.send({ type: "heartbeat", clientTime: Date.now() });
    };
    heartbeat();
    this.heartbeatTimer = window.setInterval(heartbeat, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer === null) return;
    window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}

function accessBlockedMessage(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "当前网络地址已被服务器封禁";
  if ("permanent" in payload && payload.permanent === true) {
    return "当前网络地址已被永久封禁，请联系管理员解除";
  }
  if ("retryAt" in payload && typeof payload.retryAt === "number") {
    const remainingMinutes = Math.max(1, Math.ceil((payload.retryAt - Date.now()) / 60_000));
    return `当前网络地址暂时被封禁，请在 ${remainingMinutes} 分钟后重试`;
  }
  return "当前网络地址暂时被封禁，请稍后重试";
}

export function resolveSignalingUrl(): string {
  const configured = import.meta.env.VITE_SIGNALING_URL?.trim();
  if (configured) return configured;
  if (import.meta.env.DEV) {
    const devPort = import.meta.env.VITE_DEV_API_PORT || 3001;
    return `ws://${window.location.hostname}:${devPort}/ws`;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}
