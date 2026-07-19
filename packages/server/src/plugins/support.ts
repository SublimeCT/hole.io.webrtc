import fp from "fastify-plugin";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { resolveCorsOrigin } from "../config.js";
import type { Config } from "../config.js";
import type { AbuseConfig } from "../config/abuse.js";

export interface SupportOptions {
  config: Config;
  abuse: AbuseConfig;
}

/**
 * 全局支撑插件：CORS、WebSocket、统一错误处理。用 fp 打破封装，下游可见。
 */
export default fp(
  async (app, opts: SupportOptions) => {
    await app.register(cors, {
      origin: resolveCorsOrigin(opts.config.CORS_ORIGIN),
    });

    await app.register(websocket, {
      options: {
        maxPayload: opts.abuse.MAX_PAYLOAD_BYTES,
      },
    });

    app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
      request.log.error({ err: error }, "request error");
      const statusCode = error.statusCode ?? 500;
      reply.code(statusCode).send({
        error: error.name,
        message: error.message,
        statusCode,
      });
    });
  },
  { name: "support" },
);
