import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import type {
  ClientToServerMessage,
  PeerId,
  RoomErrorCode,
  ServerToClientMessage,
} from "@hole-io/shared/protocol";
import { resolveCorsOrigin, resolveTurnUris } from "../config.js";
import type { Config } from "../config.js";
import type { AbuseConfig } from "../config/abuse.js";
import { generateTurnCredentials } from "../turn.js";
import { AbuseGuard } from "./abuseGuard.js";
import { RoomStore, type Room } from "./roomStore.js";

export interface SignalingOptions {
  config: Config;
  abuse: AbuseConfig;
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const RATE_WINDOW_MS = 1000;
// ws 的 WebSocket.OPEN === 1；用字面量避免对 @fastify/websocket 的值导入（verbatimModuleSyntax 友好）。
const SOCKET_OPEN = 1;

interface PeerConn {
  peerId: PeerId;
  ws: WebSocket;
  ip: string;
  alive: boolean;
  msgCount: number;
  windowResetAt: number;
}

function isClientMessage(value: unknown): value is ClientToServerMessage {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === "create-room" ||
    type === "join-room" ||
    type === "start-match" ||
    type === "close-room" ||
    type === "signal"
  );
}

function joinErrorMsg(code: "ROOM_NOT_FOUND" | "ROOM_FULL"): string {
  return code === "ROOM_NOT_FOUND" ? "room not found" : "room is full";
}

function startMatchErrorMsg(code: "NOT_HOST" | "EMPTY" | "ALREADY_STARTED"): string {
  if (code === "NOT_HOST") return "only host can start";
  if (code === "EMPTY") return "need at least one guest";
  return "match already started";
}

const signalingPlugin: FastifyPluginAsync<SignalingOptions> = async (app, opts) => {
  const { config, abuse } = opts;
  const guard = new AbuseGuard({
    maxConnections: abuse.MAX_CONNECTIONS,
    maxConnectionsPerIp: abuse.MAX_CONNECTIONS_PER_IP,
  });
  const store = new RoomStore({
    maxPeers: abuse.MAX_PEERS_PER_ROOM,
    roomIdleMs: abuse.ROOM_IDLE_MS,
    now: () => Date.now(),
  });
  const allowedOrigins = resolveCorsOrigin(config.CORS_ORIGIN);
  const turnUris = resolveTurnUris(config.TURN_URIS);
  const peers = new Map<PeerId, PeerConn>();

  const send = (ws: WebSocket, msg: ServerToClientMessage): void => {
    if (ws.readyState === SOCKET_OPEN) ws.send(JSON.stringify(msg));
  };

  const turnCreds = (peerId: PeerId) =>
    generateTurnCredentials(
      config.TURN_SECRET,
      peerId,
      config.TURN_TTL_SECONDS,
      turnUris,
      Date.now(),
    );

  const broadcast = (room: Room, msg: ServerToClientMessage, exclude?: PeerId): void => {
    for (const peer of room.peers.values()) {
      if (exclude !== undefined && peer.peerId === exclude) continue;
      const conn = peers.get(peer.peerId);
      if (conn) send(conn.ws, msg);
    }
  };

  const closePeerWs = (peerId: PeerId): void => {
    const conn = peers.get(peerId);
    if (conn && conn.ws.readyState === SOCKET_OPEN) conn.ws.close();
  };

  store.setIdleHandler((code) => {
    const members = store.forceClose(code) ?? [];
    for (const info of members) {
      const conn = peers.get(info.peerId);
      if (conn) send(conn.ws, { type: "room-closed", reason: "idle" });
    }
    for (const info of members) closePeerWs(info.peerId);
  });

  const heartbeat = setInterval(() => {
    for (const conn of peers.values()) {
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      conn.ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  app.addHook("onClose", () => clearInterval(heartbeat));

  const checkRate = (conn: PeerConn): boolean => {
    const now = Date.now();
    if (now > conn.windowResetAt) {
      conn.windowResetAt = now + RATE_WINDOW_MS;
      conn.msgCount = 0;
    }
    conn.msgCount += 1;
    return conn.msgCount <= abuse.SIGNAL_RATE_PER_SOCKET_PER_SECOND;
  };

  const sendError = (ws: WebSocket, code: RoomErrorCode, message: string): void => {
    send(ws, { type: "room-error", code, message });
  };

  const dispatch = (msg: ClientToServerMessage, conn: PeerConn): void => {
    const { peerId, ws } = conn;
    switch (msg.type) {
      case "create-room": {
        if (store.roomOfPeer(peerId) !== undefined) {
          sendError(ws, "INVALID_CODE", "already in a room");
          break;
        }
        if (store.size >= abuse.MAX_ROOMS) {
          sendError(ws, "INVALID_CODE", "too many rooms");
          break;
        }
        const room = store.createRoom({ peerId, playerName: msg.playerName });
        send(ws, {
          type: "room-created",
          roomCode: room.code,
          peerId,
          turn: turnCreds(peerId),
        });
        break;
      }
      case "join-room": {
        if (store.roomOfPeer(peerId) !== undefined) {
          sendError(ws, "INVALID_CODE", "already in a room");
          break;
        }
        const result = store.joinRoom(msg.roomCode, { peerId, playerName: msg.playerName });
        if (!result.ok) {
          sendError(ws, result.errorCode, joinErrorMsg(result.errorCode));
          break;
        }
        send(ws, {
          type: "room-joined",
          roomCode: result.room.code,
          peerId,
          hostPeerId: result.room.hostPeerId,
          existingPeers: result.existingPeers,
          turn: turnCreds(peerId),
        });
        broadcast(
          result.room,
          { type: "peer-joined", peer: { peerId, playerName: msg.playerName, isHost: false } },
          peerId,
        );
        break;
      }
      case "start-match": {
        const room = store.roomOfPeer(peerId);
        if (room === undefined) {
          sendError(ws, "INVALID_CODE", "not in a room");
          break;
        }
        const result = store.startMatch(room.code, peerId);
        if (!result.ok) sendError(ws, result.errorCode, startMatchErrorMsg(result.errorCode));
        // 成功不回执：host 已确认 P2P 建立成功，发完即开始 DataChannel 广播；可断 WSS。
        break;
      }
      case "close-room": {
        const room = store.roomOfPeer(peerId);
        if (room === undefined) {
          sendError(ws, "INVALID_CODE", "not in a room");
          break;
        }
        const members = store.closeRoom(room.code, peerId);
        if (members === null) {
          sendError(ws, "NOT_HOST", "only host can close");
          break;
        }
        for (const info of members) {
          if (info.peerId === peerId) continue;
          const c = peers.get(info.peerId);
          if (c) send(c.ws, { type: "room-closed", reason: "closed" });
        }
        for (const info of members) {
          if (info.peerId === peerId) continue;
          closePeerWs(info.peerId);
        }
        break;
      }
      case "signal": {
        const room = store.roomOfPeer(peerId);
        if (room === undefined) {
          sendError(ws, "INVALID_CODE", "not in a room");
          break;
        }
        const target = room.peers.get(msg.toPeerId);
        if (target === undefined) {
          sendError(ws, "INVALID_CODE", "target peer not found");
          break;
        }
        const targetConn = peers.get(target.peerId);
        if (targetConn) {
          send(targetConn.ws, {
            type: "signal",
            fromPeerId: peerId,
            kind: msg.kind,
            payload: msg.payload,
          });
        }
        break;
      }
    }
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
        const result = guard.acquire(request.ip);
        if (!result.ok) {
          reply.code(429).send({ error: "rate limited", reason: result.reason });
        }
      },
    },
    (socket, request) => {
      const peerId: PeerId = randomUUID();
      const conn: PeerConn = {
        peerId,
        ws: socket,
        ip: request.ip,
        alive: true,
        msgCount: 0,
        windowResetAt: Date.now() + RATE_WINDOW_MS,
      };
      peers.set(peerId, conn);

      socket.on("pong", () => {
        conn.alive = true;
      });

      socket.on("message", (raw: { toString(): string }) => {
        if (!checkRate(conn)) {
          sendError(socket, "INVALID_CODE", "rate limited");
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw.toString());
        } catch {
          sendError(socket, "INVALID_CODE", "invalid json");
          return;
        }
        if (!isClientMessage(parsed)) {
          sendError(socket, "INVALID_CODE", "unknown message");
          return;
        }
        dispatch(parsed, conn);
      });

      socket.on("close", () => {
        peers.delete(peerId);
        guard.release(conn.ip);
        const detach = store.detachPeer(peerId);
        if (detach.outcome === "guest-left") {
          for (const info of detach.remaining) {
            const c = peers.get(info.peerId);
            if (c) send(c.ws, { type: "peer-left", peerId });
          }
        } else if (detach.outcome === "host-left-lobby") {
          for (const info of detach.remaining) {
            const c = peers.get(info.peerId);
            if (c) send(c.ws, { type: "room-closed", reason: "host-left" });
          }
          for (const info of detach.remaining) closePeerWs(info.peerId);
        }
        // host-left-playing / no-op：无需处理
      });
    },
  );
};

export default signalingPlugin;
