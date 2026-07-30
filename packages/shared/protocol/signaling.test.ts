import { describe, expect, it } from "vitest";
import type { PlayerProfile, RoomCode } from "./signaling.js";
import {
  isClientToServerMessage,
  isServerToClientMessage,
  normalizePlayerProfile,
} from "./signaling.js";

const room = {
  roomCode: "ABC234" as RoomCode,
  status: "lobby" as const,
  cycle: 1,
  peers: [],
  lobbyExpiresAt: 10_000,
  connectionExpiresAt: null,
  matchEndsAt: null,
};

const turn = {
  username: "expires:peer",
  credential: "credential",
  ttl: 3_600,
  stunUris: ["stun:game.example.com:5349"],
  uris: ["turn:game.example.com:5349?transport=udp"],
};

describe("signaling protocol", () => {
  it("accepts a valid server room message", () => {
    expect(isServerToClientMessage({ type: "room-created", room, turn })).toBe(true);
  });

  it("accepts kick-peer (client) and kicked (server) messages", () => {
    expect(isClientToServerMessage({ type: "kick-peer", peerId: "guest-1" })).toBe(true);
    expect(isClientToServerMessage({ type: "kick-peer", peerId: "guest-1", extra: true })).toBe(
      false,
    );
    expect(isServerToClientMessage({ type: "kicked", roomCode: room.roomCode })).toBe(true);
  });

  it("rejects unknown fields and incomplete ICE server credentials", () => {
    expect(isServerToClientMessage({ type: "room-created", room, turn, unexpected: true })).toBe(
      false,
    );
    const { stunUris: _stunUris, ...turnWithoutStun } = turn;
    expect(isServerToClientMessage({ type: "room-created", room, turn: turnWithoutStun })).toBe(
      false,
    );
  });

  it("normalizes a valid profile and rejects invalid runtime fields", () => {
    expect(
      normalizePlayerProfile({
        playerName: "  Ａlice  ",
        color: "#aabbcc",
        language: "zh-CN",
        platform: "  Web  ",
      }),
    ).toEqual({
      playerName: "Alice",
      color: "#AABBCC",
      language: "zh-CN",
      platform: "Web",
    });

    expect(
      normalizePlayerProfile({
        playerName: "A!",
        color: "not-a-color",
        language: "zh-CN",
        platform: "Web",
      } as PlayerProfile),
    ).toBeNull();
  });

  it("counts supplementary Unicode letters as characters instead of UTF-16 code units", () => {
    const extendedCjkName = "𠮷".repeat(10);
    expect(
      normalizePlayerProfile({
        playerName: extendedCjkName,
        color: "#AABBCC",
        language: "zh-CN",
        platform: "Web",
      }),
    ).toMatchObject({ playerName: extendedCjkName });
  });
});
