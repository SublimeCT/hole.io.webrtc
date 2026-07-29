import { describe, expect, it } from "vitest";
import type { PeerId, PlayerProfile } from "@hole-io/shared/protocol";
import { HEARTBEAT_TIMEOUT_MS, MATCH_DURATION_MS } from "../constants.js";
import { MemoryPersistence } from "../db/memoryPersistence.js";
import { RoomService } from "./roomService.js";

const profile = (playerName: string): PlayerProfile => ({
  playerName,
  color: "#12ABEF",
  language: "zh-CN",
  platform: "test",
});

describe("RoomService", () => {
  it("runs lobby → connecting → playing → lobby and requires re-entry", async () => {
    let now = 1_000;
    const service = new RoomService(new MemoryPersistence(), () => now);
    const host = "host" as PeerId;
    const guest = "guest" as PeerId;
    const created = await service.createRoom(host, profile("Host"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(service.enterRoom(created.value.code, guest, profile("Guest")).ok).toBe(true);
    expect(service.setReady(host, true).ok).toBe(true);
    expect(service.setReady(guest, true).ok).toBe(true);
    const connecting = await service.beginConnection(host);
    expect(connecting.ok && connecting.value.status).toBe("connecting");

    const started = await service.startMatch(host);
    expect(started.ok && started.value.room.status).toBe("playing");
    now += MATCH_DURATION_MS + 1;
    service.heartbeat(host);
    service.heartbeat(guest);
    const events = await service.sweep();
    expect(events).toEqual([
      expect.objectContaining({
        type: "match-ended",
        roomCode: created.value.code,
      }),
    ]);

    const room = service.getRoom(created.value.code);
    expect(room?.status).toBe("lobby");
    expect(room?.cycle).toBe(2);
    expect(room?.members.get(host)).toMatchObject({ entered: false, ready: false });
    expect(service.roomForPeer(guest)).toBeUndefined();
    expect(service.enterRoom(created.value.code, guest, profile("Guest")).ok).toBe(true);
    expect(service.enterRoom(created.value.code, host, profile("Host")).ok).toBe(true);
  });

  it("dissolves the room when host heartbeat is more than 8 seconds old", async () => {
    let now = 10_000;
    const service = new RoomService(new MemoryPersistence(), () => now);
    const host = "host" as PeerId;
    const created = await service.createRoom(host, profile("Host"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    now += HEARTBEAT_TIMEOUT_MS + 1;
    const events = await service.sweep();
    expect(events).toEqual([
      expect.objectContaining({ type: "room-closed", reason: "host-timeout" }),
    ]);
    expect(service.getRoom(created.value.code)).toBeUndefined();
  });

  it("allows host and guest signaling in lobby for immediate connection checks", async () => {
    const service = new RoomService(new MemoryPersistence(), () => 1_000);
    const host = "host" as PeerId;
    const guestA = "guest-a" as PeerId;
    const guestB = "guest-b" as PeerId;
    const created = await service.createRoom(host, profile("Host"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    service.enterRoom(created.value.code, guestA, profile("Guest A"));
    service.enterRoom(created.value.code, guestB, profile("Guest B"));
    expect(service.signalTarget(host, guestA).ok).toBe(true);
    expect(service.signalTarget(guestA, host).ok).toBe(true);
    expect(service.signalTarget(guestA, guestB)).toEqual({
      ok: false,
      error: "SIGNAL_NOT_ALLOWED",
    });

    service.setReady(host, true);
    service.setReady(guestA, true);
    service.setReady(guestB, true);
    await service.beginConnection(host);
    expect(service.signalTarget(host, guestA).ok).toBe(true);
    expect(service.signalTarget(guestA, host).ok).toBe(true);
    expect(service.signalTarget(guestA, guestB)).toEqual({
      ok: false,
      error: "SIGNAL_NOT_ALLOWED",
    });
  });

  it("updates a lobby profile and clears the player's ready state", async () => {
    const service = new RoomService(new MemoryPersistence(), () => 1_000);
    const host = "host" as PeerId;
    const created = await service.createRoom(host, profile("Host"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(service.setReady(host, true).ok).toBe(true);
    const updatedProfile = { ...profile("New Host"), color: "#ABCDEF" };
    const updated = service.updateProfile(host, updatedProfile);

    expect(updated.ok).toBe(true);
    expect(created.value.members.get(host)).toMatchObject({
      profile: updatedProfile,
      ready: false,
    });
  });

  it("rejects duplicate player names when entering or updating a lobby", async () => {
    const service = new RoomService(new MemoryPersistence(), () => 1_000);
    const host = "host" as PeerId;
    const guest = "guest" as PeerId;
    const otherGuest = "other-guest" as PeerId;
    const created = await service.createRoom(host, profile("Player One"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(service.enterRoom(created.value.code, guest, profile("player one"))).toEqual({
      ok: false,
      error: "PLAYER_NAME_TAKEN",
    });
    expect(service.enterRoom(created.value.code, guest, profile("Player Two")).ok).toBe(true);
    expect(service.enterRoom(created.value.code, otherGuest, profile("Player 3")).ok).toBe(true);
    expect(service.updateProfile(otherGuest, profile("PLAYER TWO"))).toEqual({
      ok: false,
      error: "PLAYER_NAME_TAKEN",
    });
  });

  it("rejects profile updates after WebRTC connection setup starts", async () => {
    const service = new RoomService(new MemoryPersistence(), () => 1_000);
    const host = "host" as PeerId;
    const guest = "guest" as PeerId;
    const created = await service.createRoom(host, profile("Host"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    service.enterRoom(created.value.code, guest, profile("Guest"));
    service.setReady(host, true);
    service.setReady(guest, true);
    await service.beginConnection(host);

    expect(service.updateProfile(guest, profile("Changed"))).toEqual({
      ok: false,
      error: "INVALID_STATE",
    });
  });
});
