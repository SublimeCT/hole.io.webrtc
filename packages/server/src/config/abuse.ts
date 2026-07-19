import envSchema from "env-schema";
import { Type, type Static } from "@sinclair/typebox";

// 防滥用参数独立配置（与 server 通用 config 分离）。
// 这是缓解层（AGENTS.md §8），非根治。所有值 env 可覆盖。
const schema = Type.Object({
  MAX_CONNECTIONS: Type.Integer({ default: 100, minimum: 1 }),
  MAX_CONNECTIONS_PER_IP: Type.Integer({ default: 5, minimum: 1 }),
  MAX_ROOMS: Type.Integer({ default: 20, minimum: 1 }),
  MAX_PEERS_PER_ROOM: Type.Integer({ default: 4, minimum: 1 }),
  SIGNAL_RATE_PER_SOCKET_PER_SECOND: Type.Integer({ default: 60, minimum: 1 }),
  ROOM_IDLE_MS: Type.Integer({ default: 180_000, minimum: 1000 }),
  MAX_PAYLOAD_BYTES: Type.Integer({ default: 1 << 18, minimum: 1024 }),
});

export type AbuseConfig = Static<typeof schema>;

export function loadAbuseConfig(): AbuseConfig {
  return envSchema<AbuseConfig>({ schema });
}
