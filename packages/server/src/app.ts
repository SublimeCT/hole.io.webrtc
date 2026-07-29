import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.js";
import { resolveTrustProxy } from "./config.js";
import type { Persistence } from "./db/persistence.js";
import databasePlugin from "./plugins/database.js";
import securityPlugin from "./plugins/security.js";
import supportPlugin from "./plugins/support.js";
import signalingPlugin from "./signaling/signalingPlugin.js";

export interface AppOptions {
  config: Config;
  persistence?: Persistence;
  now?: () => number;
  sweepIntervalMs?: number;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const now = opts.now ?? Date.now;
  const logLevel = opts.config.LOG_LEVEL ?? "info";
  const app = Fastify({
    logger:
      logLevel === "silent"
        ? false
        : {
            level: logLevel,
            redact: [
              "req.headers.authorization",
              "*.password",
              "*.secret",
              "*.credential",
              "*.DATABASE_URL",
              "*.TURN_SECRET",
            ],
          },
    trustProxy: resolveTrustProxy(opts.config.TRUST_PROXY),
  });

  await app.register(supportPlugin, { config: opts.config });
  await app.register(
    databasePlugin,
    opts.persistence === undefined
      ? { config: opts.config }
      : { config: opts.config, persistence: opts.persistence },
  );
  await app.register(securityPlugin, { now });
  const signalingOptions = {
    config: opts.config,
    persistence: app.persistence,
    now,
  };
  await app.register(
    signalingPlugin,
    opts.sweepIntervalMs === undefined
      ? signalingOptions
      : { ...signalingOptions, sweepIntervalMs: opts.sweepIntervalMs },
  );

  app.get("/access-status", async () => ({ allowed: true }));

  app.get("/health", async (_request, reply) => {
    const database = await app.persistence.health();
    if (!database) reply.code(503);
    return { status: database ? "ok" : "degraded", database };
  });

  return app;
}
