import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { WebSocket } from "ws";
import { buildApp } from "../app.js";
import { loadConfig, type Config } from "../config.js";

// 用 loadConfig() 拿到所有字段的默认值，再覆盖测试需要的几项，
// 避免新增配置字段时漏改 baseConfig（曾因此导致 IDLE_TIMEOUT_MS 为 undefined 触发立即断开）。
const baseConfig: Config = {
  ...loadConfig(),
  PORT: 0,
  HOST: "127.0.0.1",
  LOG_LEVEL: "silent",
};

let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  app = await buildApp({ config: baseConfig });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address() as AddressInfo;
  baseUrl = `ws://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await app.close();
});

function connect(path = "/ws"): WebSocket {
  return new WebSocket(`${baseUrl}${path}`);
}

function opened(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
}

function recv(ws: WebSocket, timeoutMs = 2000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("recv timeout")), timeoutMs);
    ws.once("message", (data: { toString(): string }) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(data.toString()) as Record<string, unknown>);
      } catch (e) {
        reject(e);
      }
    });
    ws.once("error", reject);
  });
}

function sendMsg(ws: WebSocket, msg: unknown): void {
  ws.send(JSON.stringify(msg));
}

function closed(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    ws.once("close", () => resolve());
    ws.close();
  });
}

describe("signaling /ws", () => {
  it("responds room-created on create-room", async () => {
    const ws = connect();
    await opened(ws);
    sendMsg(ws, { type: "create-room", playerName: "alice" });
    const msg = await recv(ws);
    expect(msg).toMatchObject({ type: "room-created", isHost: true });
    expect(msg.roomCode).toHaveLength(4);
    expect(typeof msg.peerId).toBe("string");
    await closed(ws);
  });

  it("notifies the existing peer when a new peer joins", async () => {
    const host = connect();
    await opened(host);
    sendMsg(host, { type: "create-room", playerName: "alice" });
    const created = await recv(host);
    const roomCode = created.roomCode as string;

    const guest = connect();
    await opened(guest);
    sendMsg(guest, { type: "join-room", roomCode, playerName: "bob" });
    const joined = await recv(guest);
    expect(joined).toMatchObject({ type: "room-joined", isHost: false });
    expect(joined.hostPeerId).toBe(created.peerId);
    expect(joined.existingPeers).toEqual([{ peerId: created.peerId, playerName: "alice" }]);

    const notify = await recv(host);
    expect(notify).toMatchObject({ type: "peer-joined", peer: { playerName: "bob" } });

    await closed(host);
    await closed(guest);
  });

  it("relays an sdp offer to the target peer with fromPeerId", async () => {
    const host = connect();
    await opened(host);
    sendMsg(host, { type: "create-room", playerName: "alice" });
    const created = await recv(host);

    const guest = connect();
    await opened(guest);
    sendMsg(guest, { type: "join-room", roomCode: created.roomCode as string, playerName: "bob" });
    const joined = await recv(guest);
    await recv(host); // host 消费 peer-joined

    sendMsg(guest, {
      type: "sdp-offer",
      targetPeerId: joined.hostPeerId as string,
      sdp: "OFFER",
    });
    const relayed = await recv(host);
    expect(relayed).toEqual({
      type: "sdp-offer",
      fromPeerId: joined.peerId,
      sdp: "OFFER",
    });

    await closed(host);
    await closed(guest);
  });

  it("broadcasts host-disconnected when the host leaves", async () => {
    const host = connect();
    await opened(host);
    sendMsg(host, { type: "create-room", playerName: "alice" });
    const created = await recv(host);

    const guest = connect();
    await opened(guest);
    sendMsg(guest, { type: "join-room", roomCode: created.roomCode as string, playerName: "bob" });
    await recv(guest);
    await recv(host);

    await closed(host);
    const msg = await recv(guest);
    expect(msg).toEqual({ type: "host-disconnected" });

    await closed(guest);
  });

  it("broadcasts peer-left when a guest leaves", async () => {
    const host = connect();
    await opened(host);
    sendMsg(host, { type: "create-room", playerName: "alice" });
    const created = await recv(host);

    const guest = connect();
    await opened(guest);
    sendMsg(guest, { type: "join-room", roomCode: created.roomCode as string, playerName: "bob" });
    await recv(guest);
    const peerJoined = await recv(host);
    const guestPeerId = (peerJoined.peer as { peerId: string }).peerId;

    await closed(guest);
    const msg = await recv(host);
    expect(msg).toEqual({ type: "peer-left", peerId: guestPeerId });

    await closed(host);
  });

  it("replies room-error on invalid json", async () => {
    const ws = connect();
    await opened(ws);
    ws.send("not-json");
    const msg = await recv(ws);
    expect(msg.type).toBe("room-error");
    await closed(ws);
  });

  it("replies room-error on an unknown message type", async () => {
    const ws = connect();
    await opened(ws);
    sendMsg(ws, { type: "bogus" });
    const msg = await recv(ws);
    expect(msg.type).toBe("room-error");
    await closed(ws);
  });

  it("replies room-error ROOM_NOT_FOUND when joining a missing room", async () => {
    const ws = connect();
    await opened(ws);
    sendMsg(ws, { type: "join-room", roomCode: "NOPE", playerName: "x" });
    const msg = await recv(ws);
    expect(msg).toMatchObject({ type: "room-error", code: "ROOM_NOT_FOUND" });
    await closed(ws);
  });

  it("rejects connections from disallowed origins", async () => {
    const restricted = await buildApp({
      config: { ...baseConfig, CORS_ORIGIN: "http://example.com" },
    });
    await restricted.listen({ port: 0, host: "127.0.0.1" });
    const addr = restricted.server.address() as AddressInfo;
    const url = `ws://127.0.0.1:${addr.port}/ws`;

    const status = await new Promise<number>((resolve) => {
      const ws = new WebSocket(url, { headers: { origin: "http://evil.test" } });
      ws.on("unexpected-response", (_req, res) => {
        resolve(res.statusCode ?? 0);
        ws.close();
      });
      ws.on("open", () => {
        resolve(0);
        ws.close();
      });
      ws.on("error", () => resolve(0));
    });

    expect(status).toBe(403);
    await restricted.close();
  });
});

describe("signaling abuse guards", () => {
  const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  async function listenWith(
    overrides: Partial<Config>,
  ): Promise<{ app: FastifyInstance; url: string }> {
    const server = await buildApp({ config: { ...baseConfig, ...overrides } });
    await server.listen({ port: 0, host: "127.0.0.1" });
    const addr = server.server.address() as AddressInfo;
    return { app: server, url: `ws://127.0.0.1:${addr.port}/ws` };
  }

  it("closes an idle connection that never joins a room", async () => {
    const { app, url } = await listenWith({ IDLE_TIMEOUT_MS: 100 });
    const ws = new WebSocket(url);
    await opened(ws);
    await delay(250);
    expect(ws.readyState).toBe(WebSocket.CLOSED);
    await app.close();
  });

  it("rejects new connections beyond MAX_CONNECTIONS", async () => {
    const { app, url } = await listenWith({ MAX_CONNECTIONS: 1, IDLE_TIMEOUT_MS: 60_000 });
    const first = new WebSocket(url);
    await opened(first);

    const status = await new Promise<number>((resolve) => {
      const ws = new WebSocket(url);
      ws.on("unexpected-response", (_req, res) => {
        resolve(res.statusCode ?? 0);
        ws.close();
      });
      ws.on("open", () => {
        resolve(0);
        ws.close();
      });
      ws.on("error", () => resolve(0));
    });

    expect(status).toBe(429);
    first.close();
    await app.close();
  });

  it("rejects extra concurrent connections from a single IP", async () => {
    const { app, url } = await listenWith({
      MAX_CONNECTIONS: 100,
      MAX_CONNECTIONS_PER_IP: 1,
      IDLE_TIMEOUT_MS: 60_000,
    });
    const first = new WebSocket(url);
    await opened(first);

    const status = await new Promise<number>((resolve) => {
      const ws = new WebSocket(url);
      ws.on("unexpected-response", (_req, res) => {
        resolve(res.statusCode ?? 0);
        ws.close();
      });
      ws.on("open", () => {
        resolve(0);
        ws.close();
      });
      ws.on("error", () => resolve(0));
    });

    expect(status).toBe(429);
    first.close();
    await app.close();
  });

  it("refuses create-room beyond MAX_ROOMS", async () => {
    const { app, url } = await listenWith({ MAX_ROOMS: 1 });
    const a = new WebSocket(url);
    await opened(a);
    sendMsg(a, { type: "create-room", playerName: "a" });
    await recv(a);

    const b = new WebSocket(url);
    await opened(b);
    sendMsg(b, { type: "create-room", playerName: "b" });
    const msg = await recv(b);
    expect(msg).toMatchObject({ type: "room-error" });

    a.close();
    b.close();
    await app.close();
  });
});
