import Fastify, { type FastifyInstance } from "fastify";
import supportPlugin from "./plugins/support.js";
import signalingPlugin from "./signaling/signalingPlugin.js";
import type { Config } from "./config.js";
import type { AbuseConfig } from "./config/abuse.js";

export interface AppOptions {
  config: Config;
  abuse: AbuseConfig;
}

/** 构建未监听的 Fastify 实例，便于测试用 inject()/真实 listen。 */
export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: opts.config.LOG_LEVEL },
    bodyLimit: opts.abuse.MAX_PAYLOAD_BYTES,
    trustProxy: true,
  });

  await app.register(supportPlugin, { config: opts.config, abuse: opts.abuse });
  await app.register(signalingPlugin, { config: opts.config, abuse: opts.abuse });

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}
