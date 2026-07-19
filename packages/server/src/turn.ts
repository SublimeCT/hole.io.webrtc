import { createHmac } from "node:crypto";
import type { TurnCredentials } from "@hole-io/shared/protocol";

/**
 * 生成 coturn auth-secret 短期凭证（与 coturn 的 use-auth-secret + static-auth-secret 配合）。
 * 算法：username = "{expiryEpoch}:{peerId}"，credential = base64(hmac-sha1(secret, username))。
 * coturn 按同一 secret + username 重算 hmac 校验。
 *
 * now（epoch ms）由调用方注入，便于测试。
 */
export function generateTurnCredentials(
  secret: string,
  peerId: string,
  ttlSeconds: number,
  uris: readonly string[],
  now: number,
): TurnCredentials {
  const expiry = Math.floor(now / 1000) + ttlSeconds;
  const username = `${expiry}:${peerId}`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");
  return { username, credential, ttl: ttlSeconds, uris };
}
