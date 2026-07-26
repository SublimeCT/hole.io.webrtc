import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateTurnCredentials } from "./turn.js";

const URIS = ["turn:localhost:3478?transport=udp", "turn:localhost:3478?transport=tcp"];
const STUN_URIS = ["stun:localhost:3478"];
const SECRET = "test-turn-secret-that-is-at-least-32-chars";

describe("generateTurnCredentials", () => {
  it("builds username as expiry:peerId and carries ttl/uris", () => {
    const credentials = generateTurnCredentials(SECRET, "peer-1", 3600, STUN_URIS, URIS, 1_000_000);
    const expiry = Math.floor(1_000_000 / 1000) + 3600;
    expect(credentials.username).toBe(`${expiry}:peer-1`);
    expect(credentials.ttl).toBe(3600);
    expect(credentials.stunUris).toEqual(STUN_URIS);
    expect(credentials.uris).toEqual(URIS);
  });

  it("computes a coturn-compatible base64 HMAC-SHA1 credential", () => {
    const credentials = generateTurnCredentials(SECRET, "peer-1", 3600, STUN_URIS, URIS, 1_000_000);
    const expected = createHmac("sha1", SECRET).update(credentials.username).digest("base64");
    expect(credentials.credential).toBe(expected);
  });

  it("scopes credentials to the peer and configured secret", () => {
    const peerA = generateTurnCredentials(SECRET, "peer-a", 3600, STUN_URIS, URIS, 1_000_000);
    const peerB = generateTurnCredentials(SECRET, "peer-b", 3600, STUN_URIS, URIS, 1_000_000);
    const otherSecret = generateTurnCredentials(
      `${SECRET}-other`,
      "peer-a",
      3600,
      STUN_URIS,
      URIS,
      1_000_000,
    );
    expect(peerA.username).not.toBe(peerB.username);
    expect(peerA.credential).not.toBe(peerB.credential);
    expect(peerA.credential).not.toBe(otherSecret.credential);
  });

  it("rejects weak secrets and malformed TURN service inputs", () => {
    expect(() => generateTurnCredentials("short", "peer-1", 3600, STUN_URIS, URIS, 0)).toThrow(
      "at least 32",
    );
    expect(() => generateTurnCredentials(SECRET, "bad peer", 3600, STUN_URIS, URIS, 0)).toThrow(
      "peer id",
    );
    expect(() => generateTurnCredentials(SECRET, "peer-1", 30, STUN_URIS, URIS, 0)).toThrow("TTL");
    expect(() => generateTurnCredentials(SECRET, "peer-1", 3600, [], URIS, 0)).toThrow("STUN URIs");
    expect(() =>
      generateTurnCredentials(SECRET, "peer-1", 3600, STUN_URIS, ["https://turn.test"], 0),
    ).toThrow("TURN URIs");
  });
});
