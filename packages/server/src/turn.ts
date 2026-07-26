import { createHmac } from "node:crypto";
import type { TurnCredentials } from "@hole-io/shared/protocol";

const PEER_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export function generateTurnCredentials(
  secret: string,
  peerId: string,
  ttlSeconds: number,
  stunUris: readonly string[],
  uris: readonly string[],
  now: number,
): TurnCredentials {
  if (secret.length < 32) throw new Error("TURN secret must contain at least 32 characters");
  if (!PEER_ID_PATTERN.test(peerId)) throw new Error("invalid TURN peer id");
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 86_400) {
    throw new Error("TURN TTL must be an integer between 60 and 86400 seconds");
  }
  if (
    stunUris.length === 0 ||
    stunUris.some((uri) => !uri.startsWith("stun:") || uri.length > 2048)
  ) {
    throw new Error("STUN URIs must be non-empty stun: URIs");
  }
  if (
    uris.length === 0 ||
    uris.some((uri) => (!uri.startsWith("turn:") && !uri.startsWith("turns:")) || uri.length > 2048)
  ) {
    throw new Error("TURN URIs must be non-empty turn: or turns: URIs");
  }
  if (!Number.isFinite(now) || now < 0) throw new Error("invalid credential timestamp");

  const expiry = Math.floor(now / 1000) + ttlSeconds;
  const username = `${expiry}:${peerId}`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");
  return {
    username,
    credential,
    ttl: ttlSeconds,
    stunUris: [...stunUris],
    uris: [...uris],
  };
}
