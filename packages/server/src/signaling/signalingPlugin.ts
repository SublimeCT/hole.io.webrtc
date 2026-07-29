import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import {
  isClientToServerMessage,
  normalizePlayerProfile,
  type ClientToServerMessage,
  type PeerId,
  type RoomErrorCode,
  type ServerToClientMessage,
  type SignalOutMessage,
} from "@hole-io/shared/protocol";
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  INVALID_MESSAGES_BEFORE_CLOSE,
  ROOM_SWEEP_INTERVAL_MS,
  WS_MESSAGES_PER_SECOND,
} from "../constants.js";
import type { Config } from "../config.js";
import { resolveCorsOrigin, resolveCsv } from "../config.js";
import type { Persistence } from "../db/persistence.js";
import { RoomService, type RoomEvent, type RoomFailure } from "../room/roomService.js";
import { generateTurnCredentials } from "../turn.js";

const SOCKET_OPEN = 1;
const RATE_WINDOW_MS = 1000;
const MAX_CONNECTIONS = 100;
const MAX_CONNECTIONS_PER_IP = 5;
const MAX_PENDING_MESSAGES_PER_CONNECTION = 8;
const MAX_SOCKET_BUFFERED_BYTES = 256 * 1024;

interface PeerConnection {
  peerId: PeerId;
  socket: WebSocket;
  ip: string;
  messageCount: number;
  windowStartedAt: number;
  invalidMessages: number;
  pendingMessages: number;
  queue: Promise<void>;
}

export interface SignalingOptions {
  config: Config;
  persistence: Persistence;
  now: () => number;
  sweepIntervalMs?: number;
}

function errorMessage(code: RoomErrorCode): string {
  switch (code) {
    case "ROOM_UNAVAILABLE":
      return "room unavailable";
    case "ROOM_LIMIT_REACHED":
      return "room limit reached";
    case "PLAYER_NAME_TAKEN":
      return "player name is already in use";
    case "ALREADY_IN_ROOM":
      return "already in a room";
    case "NOT_IN_ROOM":
      return "not in a room";
    case "NOT_HOST":
      return "only the host may perform this action";
    case "NOT_READY":
      return "all entered players must be ready";
    case "INVALID_STATE":
      return "action is not allowed in the current room state";
    case "MATCH_IN_PROGRESS":
      return "only heartbeat and leave-room messages are accepted while playing";
    case "SIGNAL_NOT_ALLOWED":
      return "signal target is not allowed";
    case "RATE_LIMITED":
      return "rate limited";
    case "ACCESS_BLOCKED":
      return "access blocked";
    case "INVALID_MESSAGE":
      return "invalid message";
    default:
      return "internal error";
  }
}

function roomFailureCode(error: RoomFailure): RoomErrorCode {
  return error;
}

const signalingPlugin: FastifyPluginAsync<SignalingOptions> = async (app, opts) => {
  const now = opts.now;
  const roomService = new RoomService(opts.persistence, now);
  const connections = new Map<PeerId, PeerConnection>();
  const connectionCountByIp = new Map<string, number>();
  const allowedOrigins = resolveCorsOrigin(opts.config.CORS_ORIGIN);
  const stunUris = resolveCsv(opts.config.STUN_URIS);
  const turnUris = resolveCsv(opts.config.TURN_URIS);

  const send = (socket: WebSocket, message: ServerToClientMessage): void => {
    if (socket.readyState !== SOCKET_OPEN) return;
    if (socket.bufferedAmount > MAX_SOCKET_BUFFERED_BYTES) {
      socket.close(1013, "outbound buffer exceeded");
      return;
    }
    socket.send(JSON.stringify(message));
  };

  const sendToPeer = (peerId: PeerId, message: ServerToClientMessage): void => {
    const connection = connections.get(peerId);
    if (connection !== undefined) send(connection.socket, message);
  };

  const sendError = (connection: PeerConnection, code: RoomErrorCode): void => {
    send(connection.socket, { type: "room-error", code, message: errorMessage(code) });
  };

  const rejectIpConnections = (ip: string): void => {
    for (const candidate of connections.values()) {
      if (candidate.ip !== ip) continue;
      sendError(candidate, "ACCESS_BLOCKED");
      candidate.socket.close(1008, "access blocked");
    }
  };

  const broadcastState = (room: ReturnType<RoomService["getRoom"]>, exclude?: PeerId): void => {
    if (room === undefined) return;
    const message: ServerToClientMessage = { type: "room-state", room: roomService.state(room) };
    for (const peerId of roomService.recipients(room)) {
      if (peerId !== exclude) sendToPeer(peerId, message);
    }
  };

  const publishEvent = (event: RoomEvent): void => {
    if (event.type === "room-state") {
      for (const peerId of event.recipients) {
        sendToPeer(peerId, { type: "room-state", room: event.room });
      }
    } else if (event.type === "room-closed") {
      for (const peerId of event.recipients) {
        sendToPeer(peerId, {
          type: "room-closed",
          roomCode: event.roomCode,
          reason: event.reason,
        });
      }
    } else {
      for (const peerId of event.recipients) {
        sendToPeer(peerId, {
          type: "match-ended",
          matchId: event.matchId,
          roomCode: event.roomCode,
          rejoinDeadline: event.rejoinDeadline,
          reason: "time-limit",
        });
      }
    }
  };

  const turnCredentials = (peerId: PeerId) =>
    generateTurnCredentials(
      opts.config.TURN_SECRET,
      peerId,
      opts.config.TURN_TTL_SECONDS,
      stunUris,
      turnUris,
      now(),
    );

  const relaySignal = (connection: PeerConnection, message: SignalOutMessage): void => {
    const target = roomService.signalTarget(connection.peerId, message.toPeerId);
    if (!target.ok) {
      sendError(connection, "SIGNAL_NOT_ALLOWED");
      return;
    }
    const targetConnection = connections.get(target.value.peerId);
    if (targetConnection === undefined) {
      sendError(connection, "SIGNAL_NOT_ALLOWED");
      return;
    }
    if (message.type === "signal-offer") {
      send(targetConnection.socket, {
        type: "signal-offer",
        fromPeerId: connection.peerId,
        description: message.description,
      });
    } else if (message.type === "signal-answer") {
      send(targetConnection.socket, {
        type: "signal-answer",
        fromPeerId: connection.peerId,
        description: message.description,
      });
    } else {
      send(targetConnection.socket, {
        type: "signal-ice",
        fromPeerId: connection.peerId,
        candidate: message.candidate,
      });
    }
  };

  const dispatch = async (
    connection: PeerConnection,
    message: ClientToServerMessage,
  ): Promise<void> => {
    const currentRoom = roomService.roomForPeer(connection.peerId);
    if (
      currentRoom?.status === "playing" &&
      message.type !== "heartbeat" &&
      message.type !== "leave-room"
    ) {
      sendError(connection, "MATCH_IN_PROGRESS");
      return;
    }

    switch (message.type) {
      case "create-room": {
        const profile = normalizePlayerProfile(message.profile);
        if (profile === null) {
          sendError(connection, "INVALID_MESSAGE");
          return;
        }
        const result = await roomService.createRoom(connection.peerId, profile);
        if (!result.ok) {
          sendError(connection, roomFailureCode(result.error));
          return;
        }
        send(connection.socket, {
          type: "room-created",
          room: roomService.state(result.value),
          turn: turnCredentials(connection.peerId),
        });
        return;
      }
      case "enter-room": {
        const profile = normalizePlayerProfile(message.profile);
        if (profile === null) {
          sendError(connection, "INVALID_MESSAGE");
          return;
        }
        const roomExisted = roomService.getRoom(message.roomCode) !== undefined;
        const result = roomService.enterRoom(message.roomCode, connection.peerId, profile);
        if (!result.ok) {
          if (result.error === "PLAYER_NAME_TAKEN") {
            sendError(connection, result.error);
            return;
          }
          if (!roomExisted) {
            const access = await app.accessService.recordMissingRoom(connection.ip);
            if (!access.allowed) rejectIpConnections(connection.ip);
            else sendError(connection, "ROOM_UNAVAILABLE");
          } else {
            sendError(connection, "ROOM_UNAVAILABLE");
          }
          return;
        }
        await app.accessService.recordSuccessfulEntry(connection.ip);
        send(connection.socket, {
          type: "room-entered",
          room: roomService.state(result.value),
          turn: turnCredentials(connection.peerId),
        });
        broadcastState(result.value, connection.peerId);
        return;
      }
      case "set-ready": {
        const result = roomService.setReady(connection.peerId, message.ready);
        if (!result.ok) sendError(connection, roomFailureCode(result.error));
        else broadcastState(result.value);
        return;
      }
      case "update-profile": {
        const profile = normalizePlayerProfile(message.profile);
        if (profile === null) {
          sendError(connection, "INVALID_MESSAGE");
          return;
        }
        const result = roomService.updateProfile(connection.peerId, profile);
        if (!result.ok) sendError(connection, roomFailureCode(result.error));
        else broadcastState(result.value);
        return;
      }
      case "begin-connection": {
        const result = await roomService.beginConnection(connection.peerId);
        if (!result.ok) {
          sendError(connection, roomFailureCode(result.error));
          return;
        }
        const event: ServerToClientMessage = {
          type: "connection-started",
          room: roomService.state(result.value),
        };
        for (const peerId of roomService.recipients(result.value)) sendToPeer(peerId, event);
        return;
      }
      case "signal-offer":
      case "signal-answer":
      case "signal-ice":
        relaySignal(connection, message);
        return;
      case "start-match": {
        const result = await roomService.startMatch(connection.peerId);
        if (!result.ok) {
          sendError(connection, roomFailureCode(result.error));
          return;
        }
        const state = roomService.state(result.value.room);
        const event: ServerToClientMessage = {
          type: "match-started",
          matchId: result.value.matchId,
          matchEndsAt: state.matchEndsAt ?? now(),
          room: state,
        };
        for (const peerId of roomService.recipients(result.value.room)) sendToPeer(peerId, event);
        return;
      }
      case "leave-room": {
        for (const event of await roomService.leave(connection.peerId)) publishEvent(event);
        return;
      }
      case "close-room": {
        const result = await roomService.closeByHost(connection.peerId);
        if (!result.ok) sendError(connection, roomFailureCode(result.error));
        else publishEvent(result.value);
        return;
      }
      case "heartbeat":
        roomService.heartbeat(connection.peerId);
        send(connection.socket, {
          type: "heartbeat-ack",
          clientTime: message.clientTime,
          serverTime: now(),
        });
    }
  };

  let sweepInProgress = false;
  const sweepTimer = setInterval(() => {
    if (sweepInProgress) return;
    sweepInProgress = true;
    void roomService
      .sweep()
      .then((events) => events.forEach(publishEvent))
      .catch((error: unknown) => app.log.error({ err: error }, "room sweep failed"))
      .finally(() => {
        sweepInProgress = false;
      });
  }, opts.sweepIntervalMs ?? ROOM_SWEEP_INTERVAL_MS);
  sweepTimer.unref();

  app.addHook("onClose", async () => {
    clearInterval(sweepTimer);
    const events = await roomService.shutdown();
    events.forEach(publishEvent);
  });

  app.get(
    "/ws",
    {
      websocket: true,
      preValidation: async (request, reply) => {
        if (allowedOrigins !== true) {
          const origin = request.headers.origin;
          if (typeof origin !== "string" || !allowedOrigins.includes(origin)) {
            await reply.code(403).send({ error: "forbidden origin", statusCode: 403 });
            return;
          }
        }
        const ipConnections = connectionCountByIp.get(request.ip) ?? 0;
        if (connections.size >= MAX_CONNECTIONS || ipConnections >= MAX_CONNECTIONS_PER_IP) {
          await reply.code(429).send({ error: "too many connections", statusCode: 429 });
        }
      },
    },
    (socket, request) => {
      const peerId = randomUUID() as PeerId;
      const connection: PeerConnection = {
        peerId,
        socket,
        ip: request.ip,
        messageCount: 0,
        windowStartedAt: now(),
        invalidMessages: 0,
        pendingMessages: 0,
        queue: Promise.resolve(),
      };
      connections.set(peerId, connection);
      connectionCountByIp.set(connection.ip, (connectionCountByIp.get(connection.ip) ?? 0) + 1);
      send(socket, {
        type: "connected",
        peerId,
        heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
        heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS,
      });

      socket.on("message", (raw) => {
        const currentTime = now();
        if (currentTime - connection.windowStartedAt >= RATE_WINDOW_MS) {
          connection.windowStartedAt = currentTime;
          connection.messageCount = 0;
        }
        connection.messageCount += 1;
        if (connection.messageCount > WS_MESSAGES_PER_SECOND) {
          sendError(connection, "RATE_LIMITED");
          return;
        }
        if (connection.pendingMessages >= MAX_PENDING_MESSAGES_PER_CONNECTION) {
          socket.close(1013, "message queue exceeded");
          return;
        }
        connection.pendingMessages += 1;
        connection.queue = connection.queue
          .then(async () => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(raw.toString());
            } catch {
              parsed = null;
            }
            if (!isClientToServerMessage(parsed)) {
              connection.invalidMessages += 1;
              sendError(connection, "INVALID_MESSAGE");
              if (connection.invalidMessages >= INVALID_MESSAGES_BEFORE_CLOSE) {
                socket.close(1008, "invalid protocol messages");
              }
              return;
            }
            await dispatch(connection, parsed);
          })
          .catch((error: unknown) => {
            app.log.error({ err: error, peerId }, "websocket dispatch failed");
            sendError(connection, "INTERNAL_ERROR");
          })
          .finally(() => {
            connection.pendingMessages -= 1;
          });
      });

      socket.on("error", (error) => {
        app.log.warn({ err: error, peerId }, "websocket error");
      });

      socket.on("close", () => {
        connections.delete(peerId);
        const count = (connectionCountByIp.get(connection.ip) ?? 1) - 1;
        if (count <= 0) connectionCountByIp.delete(connection.ip);
        else connectionCountByIp.set(connection.ip, count);
        // 不立即修改房间；由 8 秒 application heartbeat 超时统一裁决 host/guest 掉线。
      });
    },
  );
};

export default signalingPlugin;
