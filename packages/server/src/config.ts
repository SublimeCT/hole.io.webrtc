import { resolve } from "node:path";
import dotenv from "dotenv";
import envSchema from "env-schema";
import { Type, type Static } from "@sinclair/typebox";

const LogLevelSchema = Type.Union([
  Type.Literal("trace"),
  Type.Literal("debug"),
  Type.Literal("info"),
  Type.Literal("warn"),
  Type.Literal("error"),
  Type.Literal("fatal"),
  Type.Literal("silent"),
]);

const schema = Type.Object({
  PORT: Type.Integer({ default: 3001, minimum: 1, maximum: 65_535 }),
  HOST: Type.String({ default: "0.0.0.0", minLength: 1 }),
  LOG_LEVEL: Type.Optional(LogLevelSchema),
  CORS_ORIGIN: Type.String({ default: "http://localhost:5173" }),
  TRUST_PROXY: Type.String({ default: "127.0.0.1,::1" }),
  DATABASE_URL: Type.String({ minLength: 1 }),
  TURN_SECRET: Type.String({ minLength: 32 }),
  TURN_TTL_SECONDS: Type.Integer({ default: 3600, minimum: 60, maximum: 86_400 }),
  TURN_REALM: Type.String({ default: "hole.io", minLength: 1, maxLength: 253 }),
  STUN_URIS: Type.String({ minLength: 1 }),
  TURN_URIS: Type.String({ minLength: 1 }),
});

export type Config = Static<typeof schema>;

export function loadConfig(envDirectory = process.cwd()): Config {
  dotenv.config({ path: resolve(envDirectory, ".env.local"), quiet: true });
  dotenv.config({ path: resolve(envDirectory, ".env"), quiet: true });
  return envSchema<Config>({ schema, dotenv: false });
}

export function resolveCsv(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function resolveCorsOrigin(raw: string): true | string[] {
  return raw === "*" ? true : resolveCsv(raw);
}

export function resolveTrustProxy(raw: string): boolean | string[] {
  return raw === "*" ? true : resolveCsv(raw);
}
