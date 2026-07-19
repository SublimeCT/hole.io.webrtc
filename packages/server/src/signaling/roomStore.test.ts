import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RoomStore } from "./roomStore.js";

function makeStore(maxPeers = 4, roomIdleMs = 1000): RoomStore {
  return new RoomStore({ maxPeers, roomIdleMs, now: () => 0 });
}

describe("RoomStore", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("creates a room in lobby with host as first peer", () => {
    const store = makeStore();
    const room = store.createRoom({ peerId: "h", playerName: "host" });
    expect(room.status).toBe("lobby");
    expect(room.hostPeerId).toBe("h");
    expect([...room.peers.keys()]).toEqual(["h"]);
    expect(room.code).toHaveLength(4);
    expect(store.size).toBe(1);
  });

  it("joins a lobby room and reports existing peers", () => {
    const store = makeStore();
    const room = store.createRoom({ peerId: "h", playerName: "host" });
    const result = store.joinRoom(room.code, { peerId: "g", playerName: "guest" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.existingPeers).toEqual([{ peerId: "h", playerName: "host", isHost: true }]);
      expect([...result.room.peers.keys()]).toEqual(["h", "g"]);
    }
  });

  it("refuses join on missing room", () => {
    const store = makeStore();
    expect(store.joinRoom("NOPE", { peerId: "g", playerName: "x" })).toEqual({
      ok: false,
      errorCode: "ROOM_NOT_FOUND",
    });
  });

  it("refuses join when room is full", () => {
    const store = makeStore(2);
    const room = store.createRoom({ peerId: "h", playerName: "host" });
    expect(store.joinRoom(room.code, { peerId: "g1", playerName: "a" }).ok).toBe(true);
    expect(store.joinRoom(room.code, { peerId: "g2", playerName: "b" })).toEqual({
      ok: false,
      errorCode: "ROOM_FULL",
    });
  });

  describe("startMatch", () => {
    it("rejects NOT_HOST from non-host", () => {
      const store = makeStore();
      const room = store.createRoom({ peerId: "h", playerName: "host" });
      store.joinRoom(room.code, { peerId: "g", playerName: "guest" });
      expect(store.startMatch(room.code, "g")).toEqual({ ok: false, errorCode: "NOT_HOST" });
    });

    it("rejects EMPTY when only host present", () => {
      const store = makeStore();
      const room = store.createRoom({ peerId: "h", playerName: "host" });
      expect(store.startMatch(room.code, "h")).toEqual({ ok: false, errorCode: "EMPTY" });
    });

    it("succeeds, transitions to playing, and clears the idle timer", () => {
      const store = makeStore();
      const fired = vi.fn();
      store.setIdleHandler(fired);
      const room = store.createRoom({ peerId: "h", playerName: "host" });
      store.joinRoom(room.code, { peerId: "g", playerName: "guest" });
      expect(store.startMatch(room.code, "h")).toEqual({ ok: true });
      expect(room.status).toBe("playing");
      expect(room.idleTimer).toBeNull();
      vi.advanceTimersByTime(10_000);
      expect(fired).not.toHaveBeenCalled();
    });

    it("rejects ALREADY_STARTED on second start", () => {
      const store = makeStore();
      const room = store.createRoom({ peerId: "h", playerName: "host" });
      store.joinRoom(room.code, { peerId: "g", playerName: "guest" });
      store.startMatch(room.code, "h");
      expect(store.startMatch(room.code, "h")).toEqual({ ok: false, errorCode: "ALREADY_STARTED" });
    });
  });

  describe("detachPeer", () => {
    it("guest-left in lobby notifies remaining peers", () => {
      const store = makeStore();
      const room = store.createRoom({ peerId: "h", playerName: "host" });
      store.joinRoom(room.code, { peerId: "g", playerName: "guest" });
      const result = store.detachPeer("g");
      expect(result.outcome).toBe("guest-left");
      if (result.outcome === "guest-left") {
        expect(result.remaining.map((p) => p.peerId)).toEqual(["h"]);
      }
      expect(store.size).toBe(1);
    });

    it("host-left-lobby dissolves the room and reports remaining guests", () => {
      const store = makeStore();
      const room = store.createRoom({ peerId: "h", playerName: "host" });
      store.joinRoom(room.code, { peerId: "g", playerName: "guest" });
      const result = store.detachPeer("h");
      expect(result.outcome).toBe("host-left-lobby");
      if (result.outcome === "host-left-lobby") {
        expect(result.remaining.map((p) => p.peerId)).toEqual(["g"]);
      }
      expect(store.size).toBe(0);
    });

    it("host-left-playing does not dissolve the room", () => {
      const store = makeStore();
      const room = store.createRoom({ peerId: "h", playerName: "host" });
      store.joinRoom(room.code, { peerId: "g", playerName: "guest" });
      store.startMatch(room.code, "h");
      expect(store.detachPeer("h")).toEqual({ outcome: "host-left-playing" });
      expect(store.size).toBe(1);
    });

    it("no-op for unknown peer", () => {
      const store = makeStore();
      expect(store.detachPeer("ghost")).toEqual({ outcome: "no-op" });
    });
  });

  describe("closeRoom", () => {
    it("host closes and returns members", () => {
      const store = makeStore();
      const room = store.createRoom({ peerId: "h", playerName: "host" });
      store.joinRoom(room.code, { peerId: "g", playerName: "guest" });
      const members = store.closeRoom(room.code, "h");
      expect(members?.map((p) => p.peerId).sort()).toEqual(["g", "h"]);
      expect(store.size).toBe(0);
    });

    it("non-host cannot close", () => {
      const store = makeStore();
      const room = store.createRoom({ peerId: "h", playerName: "host" });
      store.joinRoom(room.code, { peerId: "g", playerName: "guest" });
      expect(store.closeRoom(room.code, "g")).toBeNull();
      expect(store.size).toBe(1);
    });
  });

  it("fires idle handler after roomIdleMs in lobby", () => {
    const store = makeStore(4, 1000);
    const fired = vi.fn();
    store.setIdleHandler(fired);
    const room = store.createRoom({ peerId: "h", playerName: "host" });
    vi.advanceTimersByTime(999);
    expect(fired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fired).toHaveBeenCalledTimes(1);
    expect(fired).toHaveBeenCalledWith(room.code);
  });
});
