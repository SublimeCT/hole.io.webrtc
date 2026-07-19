import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import type {
  ClientToServerMessage,
  IceCandidateOutMessage,
  PeerId,
  PeerInfo,
  RoomErrorCode,
  SdpAnswerOutMessage,
  SdpOfferOutMessage,
  ServerToClientMessage,
} from "@hole-io/shared/protocol";
import { resolveCorsOrigin } from "../config.js";
import type { Config } from "../config.js";
import { AbuseGuard } from "./abuseGuard.js";
import { RoomStore, type RoomPeer, type SendableSocket } from "./roomStore.js";

export interface SignalingOptions {
  config: Config;
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 1000;
// ws 的 WebSocket.OPEN === 1；用字面量避免对 @fastify/websocket 的值导入（verbatimModuleSyntax 友好）。
const SOCKET_OPEN = 1;
// 应用自定义 close 码：连接建起后超时未进入房间。
const CLOSE_IDLE = 4001;

function send(target: SendableSocket, msg: ServerToClientMessage): void {
  if (target.readyState === SOCKET_OPEN) {
    target.send(JSON.stringify(msg));
  }
}

function broadcastTo(
  peers: Iterable<RoomPeer>,
  msg: ServerToClientMessage,
  exclude?: PeerId,
): void {
  for (const peer of peers) {
    if (exclude !== undefined && peer.peerId === exclude) continue;
    send(peer.ws, msg);
  }
}

function isClientMessage(value: unknown): value is ClientToServerMessage {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === "create-room" ||
    type === "join-room" ||
    type === "sdp-offer" ||
    type === "sdp-answer" ||
    type === "ice-candidate"
  );
}

type RelayOutMessage = SdpOfferOutMessage | SdpAnswerOutMessage | IceCandidateOutMessage;

function toRelay(fromPeerId: PeerId, msg: RelayOutMessage): ServerToClientMessage {
  switch (msg.type) {
    case "sdp-offer":
      return { type: "sdp-offer", fromPeerId, sdp: msg.sdp };
    case "sdp-answer":
      return { type: "sdp-answer", fromPeerId, sdp: msg.sdp };
    case "ice-candidate":
      return { type: "ice-candidate", fromPeerId, candidate: msg.candidate };
  }
}

function joinErrorMessage(code: RoomErrorCode): string {
  if (code === "ROOM_NOT_FOUND") return "room not found";
  if (code === "ROOM_FULL") return "room is full";
  return "invalid code";
}

interface PeerState {
  socket: WebSocket;
  alive: boolean;
  msgCount: number;
  windowResetAt: number;
}

const signalingPlugin: FastifyPluginAsync<SignalingOptions> = async (app, opts) => {
  const { config } = opts;
  const store = new RoomStore();
  const guard = new AbuseGuard({
    maxConnections: config.MAX_CONNECTIONS,
    maxConnectionsPerIp: config.MAX_CONNECTIONS_PER_IP,
    connectRatePerMinute: config.CONNECT_RATE_PER_MINUTE,
  });
  const allowedOrigins = resolveCorsOrigin(config.CORS_ORIGIN);
  const peers = new Map<PeerId, PeerState>();

  const heartbeat = setInterval(() => {
    for (const state of peers.values()) {
      if (!state.alive) {
        state.socket.terminate();
        continue;
      }
      state.alive = false;
      state.socket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  app.addHook("onClose", () => clearInterval(heartbeat));

  const checkRateLimit = (state: PeerState): boolean => {
    const now = Date.now();
    if (now > state.windowResetAt) {
      state.windowResetAt = now + RATE_LIMIT_WINDOW_MS;
      state.msgCount = 0;
    }
    state.msgCount += 1;
    return state.msgCount <= RATE_LIMIT_MAX;
  };

  app.get(
    "/ws",
    {
      websocket: true,
      preValidation: async (request: FastifyRequest, reply: FastifyReply) => {
        if (allowedOrigins !== true) {
          const origin = request.headers.origin;
          if (typeof origin !== "string" || !allowedOrigins.includes(origin)) {
            reply.code(403).send({ error: "forbidden origin" });
            return;
          }
        }
        const result = guard.acquire(request.ip, Date.now());
        if (!result.ok) {
          reply.code(429).send({ error: "rate limited", reason: result.reason });
        }
      },
    },
    (socket, request) => {
      const peerId: PeerId = randomUUID();
      const ip = request.ip;
      const state: PeerState = {
        socket,
        alive: true,
        msgCount: 0,
        windowResetAt: Date.now() + RATE_LIMIT_WINDOW_MS,
      };
      peers.set(peerId, state);

      let joined = false;
      const idleTimer = setTimeout(() => {
        if (!joined) {
          socket.close(CLOSE_IDLE, "idle");
        }
      }, config.IDLE_TIMEOUT_MS);

      const handleMessage = (msg: ClientToServerMessage): void => {
        switch (msg.type) {
          case "create-room": {
            if (store.size >= config.MAX_ROOMS) {
              send(socket, {
                type: "room-error",
                code: "INVALID_CODE",
                message: "too many rooms",
              });
              break;
            }
            const room = store.createRoom({ peerId, playerName: msg.playerName, ws: socket });
            joined = true;
            clearTimeout(idleTimer);
            send(socket, { type: "room-created", roomCode: room.code, peerId, isHost: true });
            break;
          }
          case "join-room": {
            const result = store.joinRoom(
              msg.roomCode,
              { peerId, playerName: msg.playerName, ws: socket },
              config.MAX_PEERS_PER_ROOM,
            );
            if (!result.ok) {
              send(socket, {
                type: "room-error",
                code: result.errorCode,
                message: joinErrorMessage(result.errorCode),
              });
              break;
            }
            joined = true;
            clearTimeout(idleTimer);
            send(socket, {
              type: "room-joined",
              roomCode: result.room.code,
              peerId,
              isHost: false,
              hostPeerId: result.room.hostPeerId,
              existingPeers: result.existingPeers,
            });
            const newcomer: PeerInfo = { peerId, playerName: msg.playerName };
            broadcastTo(
              result.room.peers.values(),
              { type: "peer-joined", peer: newcomer },
              peerId,
            );
            break;
          }
          case "sdp-offer":
          case "sdp-answer":
          case "ice-candidate": {
            const senderRoom = store.roomOf(peerId);
            if (senderRoom === undefined) {
              send(socket, { type: "room-error", code: "INVALID_CODE", message: "not in a room" });
              break;
            }
            const target = senderRoom.peers.get(msg.targetPeerId);
            if (target === undefined) {
              send(socket, {
                type: "room-error",
                code: "INVALID_CODE",
                message: "target peer not found",
              });
              break;
            }
            send(target.ws, toRelay(peerId, msg));
            break;
          }
        }
      };

      socket.on("pong", () => {
        state.alive = true;
      });

      socket.on("message", (raw: { toString(): string }) => {
        if (!checkRateLimit(state)) {
          send(socket, { type: "room-error", code: "INVALID_CODE", message: "rate limited" });
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw.toString());
        } catch {
          send(socket, { type: "room-error", code: "INVALID_CODE", message: "invalid json" });
          return;
        }
        if (!isClientMessage(parsed)) {
          send(socket, { type: "room-error", code: "INVALID_CODE", message: "unknown message" });
          return;
        }
        handleMessage(parsed);
      });

      socket.on("close", () => {
        clearTimeout(idleTimer);
        guard.release(ip);
        peers.delete(peerId);
        const result = store.removePeer(peerId);
        if (result.outcome === "guest-left") {
          broadcastTo(result.remainingPeers, { type: "peer-left", peerId });
        } else if (result.outcome === "host-left") {
          broadcastTo(result.remainingPeers, { type: "host-disconnected" });
        }
      });
    },
  );
};

export default signalingPlugin;
