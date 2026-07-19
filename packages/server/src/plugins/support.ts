import fp from "fastify-plugin";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { resolveCorsOrigin, type Config } from "../config.js";

export interface SupportOptions {
  config: Config;
}

/**
 * 全局支撑插件：CORS、WebSocket、统一错误处理。
 * 用 fp 打破封装，使下游插件与路由可见。
 */
export default fp(
  async (app, opts: SupportOptions) => {
    await app.register(cors, {
      origin: resolveCorsOrigin(opts.config.CORS_ORIGIN),
    });

    await app.register(websocket, {
      options: {
        // 信令载荷（SDP/ICE）很小，256KB 上限足够且能挡异常大包。
        maxPayload: 1 << 18,
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
