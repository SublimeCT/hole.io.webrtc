import envSchema from "env-schema";
import { Type, type Static } from "@sinclair/typebox";

const schema = Type.Object({
  PORT: Type.Integer({ default: 3001 }),
  HOST: Type.String({ default: "0.0.0.0" }),
  LOG_LEVEL: Type.String({ default: "info" }),
  MAX_PEERS_PER_ROOM: Type.Integer({ default: 4, minimum: 1 }),
  // —— 防滥用参数 ——
  MAX_CONNECTIONS: Type.Integer({ default: 1000, minimum: 1 }),
  MAX_ROOMS: Type.Integer({ default: 200, minimum: 1 }),
  MAX_CONNECTIONS_PER_IP: Type.Integer({ default: 20, minimum: 1 }),
  CONNECT_RATE_PER_MINUTE: Type.Integer({ default: 60, minimum: 1 }),
  IDLE_TIMEOUT_MS: Type.Integer({ default: 10_000, minimum: 0 }),
  // 逗号分隔的 origin 白名单，例如
  // "http://localhost:5173,https://game.example.com"；"*" 表示允许任意（仅开发用）。
  CORS_ORIGIN: Type.String({ default: "*" }),
});

export type Config = Static<typeof schema>;

export function loadConfig(): Config {
  return envSchema<Config>({ schema });
}

/** 解析 CORS_ORIGIN 为 @fastify/cors 接受的 origin 配置。 */
export function resolveCorsOrigin(raw: string): true | string[] {
  if (raw === "*") return true;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
