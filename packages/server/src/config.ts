import envSchema from "env-schema";
import { Type, type Static } from "@sinclair/typebox";

const schema = Type.Object({
  PORT: Type.Integer({ default: 3001 }),
  HOST: Type.String({ default: "0.0.0.0" }),
  LOG_LEVEL: Type.String({ default: "info" }),
  // 逗号分隔的 origin 白名单；"*" 表示允许任意（仅开发用）。
  CORS_ORIGIN: Type.String({ default: "*" }),
  // —— TURN（coturn auth-secret，server 与 coturn 共享同一 secret）——
  TURN_SECRET: Type.String({ default: "dev-turn-secret-change-me" }),
  TURN_TTL_SECONDS: Type.Integer({ default: 3600, minimum: 60 }),
  TURN_REALM: Type.String({ default: "hole.io" }),
  // 逗号分隔的 TURN URI，如 "turn:host:3478?transport=udp,turn:host:3478?transport=tcp"。
  TURN_URIS: Type.String({
    default: "turn:localhost:3478?transport=udp,turn:localhost:3478?transport=tcp",
  }),
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

/** 解析 TURN_URIS 逗号分隔字符串为 URI 数组。 */
export function resolveTurnUris(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
