import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import type { FastifyError, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { MAX_WS_PAYLOAD_BYTES } from "../constants.js";
import { resolveCorsOrigin } from "../config.js";
import type { Config } from "../config.js";

export interface SupportOptions {
  config: Config;
}

const supportPlugin: FastifyPluginAsync<SupportOptions> = async (app, opts) => {
  await app.register(cors, { origin: resolveCorsOrigin(opts.config.CORS_ORIGIN) });
  await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
  await app.register(websocket, {
    options: {
      maxPayload: MAX_WS_PAYLOAD_BYTES,
      perMessageDeflate: false,
    },
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) request.log.error({ err: error }, "request failed");
    else request.log.warn({ err: error }, "request rejected");
    reply.code(statusCode).send({
      error: statusCode >= 500 ? "Internal Server Error" : error.name,
      message: statusCode >= 500 ? "internal server error" : error.message,
      statusCode,
    });
  });
};

export default fp(supportPlugin, { name: "support" });
