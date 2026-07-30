import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { buildApp } from "../app.js";
import type { Config } from "../config.js";
import { MemoryPersistence } from "../db/memoryPersistence.js";

const config: Config = {
  PORT: 0,
  HOST: "127.0.0.1",
  LOG_LEVEL: "silent",
  CORS_ORIGIN: "*",
  TRUST_PROXY: "127.0.0.1",
  DATABASE_URL: "postgresql://unused",
  TURN_SECRET: "test-turn-secret-that-is-at-least-32-chars",
  TURN_TTL_SECONDS: 3600,
  TURN_REALM: "hole.io",
  STUN_URIS: "stun:localhost:5349",
  TURN_URIS: "turn:localhost:5349?transport=udp",
};

const profile = (playerName: string) => ({
  playerName,
  color: "#12ABEF",
  language: "zh-CN",
  platform: "vitest",
});

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function receive(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("message timeout")), 2_000);
    socket.once("message", (raw) => {
      clearTimeout(timer);
      resolve(JSON.parse(raw.toString()) as Record<string, unknown>);
    });
    socket.once("error", reject);
  });
}

async function connect(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  const connected = receive(socket);
  await opened(socket);
  expect(await connected).toMatchObject({ type: "connected", heartbeatIntervalMs: 4_000 });
  return socket;
}

function send(socket: WebSocket, message: unknown): void {
  socket.send(JSON.stringify(message));
}

describe("signaling websocket", () => {
  let app: FastifyInstance;
  let url: string;

  beforeAll(async () => {
    app = await buildApp({ config, persistence: new MemoryPersistence() });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address() as AddressInfo;
    url = `ws://127.0.0.1:${address.port}/ws`;
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates a six-character room and enforces the ready/connecting/playing flow", async () => {
    const host = await connect(url);
    const hostCreated = receive(host);
    send(host, { type: "create-room", profile: profile("Host") });
    const created = await hostCreated;
    expect(created.type).toBe("room-created");
    const room = created.room as { roomCode: string };
    expect(room.roomCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

    const guest = await connect(url);
    const guestEntered = receive(guest);
    const hostJoinedState = receive(host);
    send(guest, { type: "enter-room", roomCode: room.roomCode, profile: profile("Guest") });
    const entered = await guestEntered;
    expect(entered).toMatchObject({ type: "room-entered" });
    await hostJoinedState;

    const lobbyHostSignal = receive(host);
    send(guest, {
      type: "signal-offer",
      toPeerId: (entered.room as { peers: { peerId: string; isHost: boolean }[] }).peers.find(
        (peer) => peer.isHost,
      )?.peerId,
      description: { sdp: "lobby-offer-sdp" },
    });
    expect(await lobbyHostSignal).toMatchObject({
      type: "signal-offer",
      description: { sdp: "lobby-offer-sdp" },
    });

    let guestState = receive(guest);
    let hostState = receive(host);
    send(guest, { type: "set-ready", ready: true });
    await Promise.all([guestState, hostState]);

    guestState = receive(guest);
    hostState = receive(host);
    send(host, { type: "set-ready", ready: true });
    await Promise.all([guestState, hostState]);

    const guestConnecting = receive(guest);
    const hostConnecting = receive(host);
    send(host, { type: "begin-connection" });
    expect(await guestConnecting).toMatchObject({ type: "connection-started" });
    const hostConnectionMessage = await hostConnecting;

    const hostSignal = receive(host);
    send(guest, {
      type: "signal-offer",
      toPeerId: (
        hostConnectionMessage.room as { peers: { peerId: string; isHost: boolean }[] }
      ).peers.find((peer) => peer.isHost)?.peerId,
      description: { sdp: "offer-sdp" },
    });
    expect(await hostSignal).toMatchObject({
      type: "signal-offer",
      description: { sdp: "offer-sdp" },
    });

    const guestStarted = receive(guest);
    const hostStarted = receive(host);
    send(host, { type: "start-match" });
    expect(await guestStarted).toMatchObject({ type: "match-started" });
    await hostStarted;

    const playingError = receive(guest);
    send(guest, { type: "set-ready", ready: false });
    expect(await playingError).toMatchObject({ type: "room-error", code: "MATCH_IN_PROGRESS" });

    const hostAfterGuestLeave = receive(host);
    send(guest, { type: "leave-room" });
    expect(await hostAfterGuestLeave).toMatchObject({
      type: "room-state",
      room: { status: "playing", peers: [{ isHost: true }] },
    });

    host.close();
    guest.close();
  });

  it("strictly rejects additional message fields", async () => {
    const socket = await connect(url);
    const error = receive(socket);
    send(socket, { type: "heartbeat", clientTime: 1, injected: true });
    expect(await error).toMatchObject({ type: "room-error", code: "INVALID_MESSAGE" });
    socket.close();
  });

  it("returns a structured access error for blocked IP addresses", async () => {
    const blockedIp = "203.0.113.50";
    await app.persistence.saveIpAccess({
      ip: blockedIp,
      consecutiveMisses: 0,
      totalMisses: 10,
      blockedUntil: null,
      permanentlyBlocked: true,
      updatedAt: Date.now(),
    });
    const response = await app.inject({
      method: "GET",
      url: "/access-status",
      remoteAddress: blockedIp,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: "ACCESS_BLOCKED",
      permanent: true,
      retryAt: null,
    });
  });

  it("returns a specific error when a player name is already used in the room", async () => {
    const host = await connect(url);
    const hostCreated = receive(host);
    send(host, { type: "create-room", profile: profile("Same Name") });
    const created = await hostCreated;
    expect(created.type).toBe("room-created");

    const guest = await connect(url);
    const duplicateError = receive(guest);
    send(guest, {
      type: "enter-room",
      roomCode: (created.room as { roomCode: string }).roomCode,
      profile: profile("same name"),
    });
    expect(await duplicateError).toMatchObject({
      type: "room-error",
      code: "PLAYER_NAME_TAKEN",
    });

    host.close();
    guest.close();
  });
});
