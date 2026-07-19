import { describe, it, expect, vi } from "vitest";
import { RoomStore, type SendableSocket } from "./roomStore.js";

function mockSocket(): SendableSocket {
  return { send: vi.fn(), readyState: 1 };
}

describe("RoomStore", () => {
  it("creates a room with the creator as host", () => {
    const store = new RoomStore();
    const room = store.createRoom({ peerId: "p1", playerName: "alice", ws: mockSocket() });

    expect(room.code).toHaveLength(4);
    expect(room.hostPeerId).toBe("p1");
    expect([...room.peers.keys()]).toEqual(["p1"]);
    expect(store.getRoom(room.code)).toBe(room);
    expect(store.roomOf("p1")).toBe(room);
  });

  it("generates unique room codes across many rooms", () => {
    const store = new RoomStore();
    const codes = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const room = store.createRoom({
        peerId: `p${i}`,
        playerName: `n${i}`,
        ws: mockSocket(),
      });
      expect(codes.has(room.code)).toBe(false);
      codes.add(room.code);
    }
  });

  it("joins an existing room and reports the existing peers", () => {
    const store = new RoomStore();
    const room = store.createRoom({ peerId: "p1", playerName: "alice", ws: mockSocket() });
    const result = store.joinRoom(
      room.code,
      { peerId: "p2", playerName: "bob", ws: mockSocket() },
      4,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.existingPeers).toEqual([{ peerId: "p1", playerName: "alice" }]);
      expect([...result.room.peers.keys()]).toEqual(["p1", "p2"]);
    }
  });

  it("returns ROOM_NOT_FOUND when joining a missing room", () => {
    const store = new RoomStore();
    const result = store.joinRoom("NOPE", { peerId: "p2", playerName: "bob", ws: mockSocket() }, 4);
    expect(result).toEqual({ ok: false, errorCode: "ROOM_NOT_FOUND" });
  });

  it("returns ROOM_FULL when the room has reached the cap", () => {
    const store = new RoomStore();
    const room = store.createRoom({ peerId: "p1", playerName: "a", ws: mockSocket() });
    const joined = store.joinRoom(
      room.code,
      { peerId: "p2", playerName: "b", ws: mockSocket() },
      2,
    );
    expect(joined.ok).toBe(true);

    const result = store.joinRoom(
      room.code,
      { peerId: "p3", playerName: "c", ws: mockSocket() },
      2,
    );
    expect(result).toEqual({ ok: false, errorCode: "ROOM_FULL" });
  });

  it("reports guest-left and keeps the room when a non-host leaves", () => {
    const store = new RoomStore();
    const room = store.createRoom({ peerId: "p1", playerName: "a", ws: mockSocket() });
    store.joinRoom(room.code, { peerId: "p2", playerName: "b", ws: mockSocket() }, 4);

    const result = store.removePeer("p2");
    expect(result.outcome).toBe("guest-left");
    if (result.outcome === "guest-left") {
      expect(result.remainingPeers.map((p) => p.peerId)).toEqual(["p1"]);
    }
    expect(store.getRoom(room.code)).toBeDefined();
  });

  it("dissolves the room and reports remaining peers when host leaves", () => {
    const store = new RoomStore();
    const room = store.createRoom({ peerId: "p1", playerName: "a", ws: mockSocket() });
    store.joinRoom(room.code, { peerId: "p2", playerName: "b", ws: mockSocket() }, 4);

    const result = store.removePeer("p1");
    expect(result.outcome).toBe("host-left");
    if (result.outcome === "host-left") {
      expect(result.remainingPeers.map((p) => p.peerId)).toEqual(["p2"]);
    }
    expect(store.getRoom(room.code)).toBeUndefined();
  });

  it("empties the room when the last peer leaves", () => {
    const store = new RoomStore();
    const room = store.createRoom({ peerId: "p1", playerName: "a", ws: mockSocket() });

    const result = store.removePeer("p1");
    expect(result).toEqual({ outcome: "room-empty" });
    expect(store.getRoom(room.code)).toBeUndefined();
  });

  it("returns not-in-room for an unknown peer", () => {
    const store = new RoomStore();
    expect(store.removePeer("ghost")).toEqual({ outcome: "not-in-room" });
  });
});
