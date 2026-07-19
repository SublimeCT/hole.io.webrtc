import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { WebSocket } from "ws";
import { buildApp } from "../app.js";
import { loadConfig, type Config } from "../config.js";
import { loadAbuseConfig, type AbuseConfig } from "../config/abuse.js";

// 用 loadConfig()/loadAbuseConfig() 拿默认值再覆盖，避免漏字段（曾因此踩坑）。
const baseConfig: Config = {
  ...loadConfig(),
  PORT: 0,
  HOST: "127.0.0.1",
  LOG_LEVEL: "silent",
};
const baseAbuse: AbuseConfig = { ...loadAbuseConfig() };

let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  app = await buildApp({ config: baseConfig, abuse: baseAbuse });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address() as AddressInfo;
  baseUrl = `ws://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await app.close();
});

function connect(): WebSocket {
  return new WebSocket(`${baseUrl}/ws`);
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
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("signaling /ws", () => {
  it("create-room returns room-created with TURN credentials", async () => {
    const ws = connect();
    await opened(ws);
    sendMsg(ws, { type: "create-room", playerName: "alice" });
    const msg = await recv(ws);
    expect(msg).toMatchObject({ type: "room-created" });
    expect(msg.roomCode as string).toHaveLength(4);
    expect(typeof msg.peerId).toBe("string");
    expect((msg.turn as { uris: unknown }).uris).toBeInstanceOf(Array);
    await closed(ws);
  });

  it("join-room returns room-joined and notifies the host with peer-joined", async () => {
    const host = connect();
    await opened(host);
    sendMsg(host, { type: "create-room", playerName: "alice" });
    const created = await recv(host);

    const guest = connect();
    await opened(guest);
    sendMsg(guest, { type: "join-room", roomCode: created.roomCode as string, playerName: "bob" });
    const joined = await recv(guest);
    expect(joined).toMatchObject({ type: "room-joined" });
    expect(joined.hostPeerId).toBe(created.peerId);
    expect((joined.turn as { uris: unknown }).uris).toBeInstanceOf(Array);

    const notify = await recv(host);
    expect(notify).toMatchObject({ type: "peer-joined", peer: { playerName: "bob" } });

    await closed(host);
    await closed(guest);
  });

  it("start-match with no guests replies room-error EMPTY", async () => {
    const ws = connect();
    await opened(ws);
    sendMsg(ws, { type: "create-room", playerName: "alice" });
    await recv(ws);
    sendMsg(ws, { type: "start-match" });
    const msg = await recv(ws);
    expect(msg).toMatchObject({ type: "room-error", code: "EMPTY" });
    await closed(ws);
  });

  it("relays a signal to the target peer with fromPeerId", async () => {
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
      type: "signal",
      toPeerId: joined.hostPeerId as string,
      kind: "offer",
      payload: "OFFER",
    });
    const relayed = await recv(host);
    expect(relayed).toEqual({
      type: "signal",
      fromPeerId: joined.peerId,
      kind: "offer",
      payload: "OFFER",
    });

    await closed(host);
    await closed(guest);
  });

  it("broadcasts room-closed{host-left} when host leaves during lobby", async () => {
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
    expect(msg).toEqual({ type: "room-closed", reason: "host-left" });
    await closed(guest);
  });

  it("broadcasts room-closed{closed} when host sends close-room", async () => {
    const host = connect();
    await opened(host);
    sendMsg(host, { type: "create-room", playerName: "alice" });
    const created = await recv(host);

    const guest = connect();
    await opened(guest);
    sendMsg(guest, { type: "join-room", roomCode: created.roomCode as string, playerName: "bob" });
    await recv(guest);
    await recv(host);

    sendMsg(host, { type: "close-room" });
    const msg = await recv(guest);
    expect(msg).toEqual({ type: "room-closed", reason: "closed" });
    await closed(host);
    await closed(guest);
  });

  it("does NOT dissolve when host leaves during playing", async () => {
    const host = connect();
    await opened(host);
    sendMsg(host, { type: "create-room", playerName: "alice" });
    const created = await recv(host);

    const guest = connect();
    await opened(guest);
    sendMsg(guest, { type: "join-room", roomCode: created.roomCode as string, playerName: "bob" });
    await recv(guest);
    await recv(host);

    sendMsg(host, { type: "start-match" });
    await delay(50);
    await closed(host);
    // playing 阶段 host 断：guest 不应收到 room-closed
    await expect(recv(guest, 300)).rejects.toThrow("recv timeout");
    await closed(guest);
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

  it("rejects connections from disallowed origins", async () => {
    const restricted = await buildApp({
      config: { ...baseConfig, CORS_ORIGIN: "http://example.com" },
      abuse: baseAbuse,
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
  async function listenWith(abuseOverrides: Partial<AbuseConfig>): Promise<{
    app: FastifyInstance;
    url: string;
  }> {
    const server = await buildApp({
      config: baseConfig,
      abuse: { ...baseAbuse, ...abuseOverrides },
    });
    await server.listen({ port: 0, host: "127.0.0.1" });
    const addr = server.server.address() as AddressInfo;
    return { app: server, url: `ws://127.0.0.1:${addr.port}/ws` };
  }

  it("rejects new connections beyond MAX_CONNECTIONS", async () => {
    const { app, url } = await listenWith({ MAX_CONNECTIONS: 1 });
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

  it("closes an idle lobby room with room-closed{idle}", async () => {
    const { app, url } = await listenWith({ ROOM_IDLE_MS: 200 });
    const host = new WebSocket(url);
    await opened(host);
    sendMsg(host, { type: "create-room", playerName: "alice" });
    const created = await recv(host);

    const guest = new WebSocket(url);
    await opened(guest);
    sendMsg(guest, { type: "join-room", roomCode: created.roomCode as string, playerName: "bob" });
    await recv(guest);
    await recv(host);

    const idleMsg = await recv(guest, 1000);
    expect(idleMsg).toEqual({ type: "room-closed", reason: "idle" });

    host.close();
    guest.close();
    await app.close();
  });
});
