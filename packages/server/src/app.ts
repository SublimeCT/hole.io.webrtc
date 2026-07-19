import Fastify, { type FastifyInstance } from "fastify";
import supportPlugin from "./plugins/support.js";
import signalingPlugin from "./signaling/signalingPlugin.js";
import type { Config } from "./config.js";

export interface AppOptions {
  config: Config;
}

/** 构建未监听的 Fastify 实例，便于测试用 inject()。 */
export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: opts.config.LOG_LEVEL },
    bodyLimit: 1 << 18,
    trustProxy: true,
  });

  await app.register(supportPlugin, { config: opts.config });
  await app.register(signalingPlugin, { config: opts.config });

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}
