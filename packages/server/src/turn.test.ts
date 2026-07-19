import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { generateTurnCredentials } from "./turn.js";

const URIS = ["turn:localhost:3478?transport=udp", "turn:localhost:3478?transport=tcp"];

describe("generateTurnCredentials", () => {
  it("builds username as expiry:peerId and carries ttl/uris", () => {
    const creds = generateTurnCredentials("secret", "peer-1", 3600, URIS, 1_000_000);
    const expiry = Math.floor(1_000_000 / 1000) + 3600;
    expect(creds.username).toBe(`${expiry}:peer-1`);
    expect(creds.ttl).toBe(3600);
    expect(creds.uris).toEqual(URIS);
  });

  it("computes credential as base64(hmac-sha1(secret, username)) verifiable by coturn", () => {
    const creds = generateTurnCredentials("topsecret", "peer-1", 3600, URIS, 1_000_000);
    const expected = createHmac("sha1", "topsecret").update(creds.username).digest("base64");
    expect(creds.credential).toBe(expected);
  });

  it("produces different credentials for different peerIds", () => {
    const a = generateTurnCredentials("s", "peer-a", 3600, URIS, 1_000_000);
    const b = generateTurnCredentials("s", "peer-b", 3600, URIS, 1_000_000);
    expect(a.username).not.toBe(b.username);
    expect(a.credential).not.toBe(b.credential);
  });

  it("produces different credentials for different secrets", () => {
    const a = generateTurnCredentials("secret-a", "peer-1", 3600, URIS, 1_000_000);
    const b = generateTurnCredentials("secret-b", "peer-1", 3600, URIS, 1_000_000);
    expect(a.credential).not.toBe(b.credential);
  });

  it("advances expiry with ttl", () => {
    const a = generateTurnCredentials("s", "peer-1", 60, URIS, 0);
    const b = generateTurnCredentials("s", "peer-1", 120, URIS, 0);
    expect(Number(b.username.split(":")[0])).toBeGreaterThan(Number(a.username.split(":")[0]));
  });
});
