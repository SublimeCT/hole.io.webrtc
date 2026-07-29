import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { AccessService } from "../security/accessService.js";

declare module "fastify" {
  interface FastifyInstance {
    accessService: AccessService;
  }
}

export interface SecurityOptions {
  now: () => number;
}

const securityPlugin: FastifyPluginAsync<SecurityOptions> = async (app, opts) => {
  const accessService = new AccessService(app.persistence, opts.now);
  app.decorate("accessService", accessService);
  app.addHook("onRequest", async (request, reply) => {
    const decision = await accessService.check(request.ip);
    if (!decision.allowed) {
      if (decision.retryAt !== null) {
        reply.header("retry-after", Math.max(1, Math.ceil((decision.retryAt - opts.now()) / 1000)));
      }
      await reply.code(403).send({
        code: "ACCESS_BLOCKED",
        message: decision.permanent
          ? "network address is permanently blocked"
          : "network address is temporarily blocked",
        permanent: decision.permanent,
        retryAt: decision.retryAt,
        statusCode: 403,
      });
    }
  });
};

export default fp(securityPlugin, {
  name: "security",
  dependencies: ["database"],
});
