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
      await reply.code(403).send({ error: "access blocked", statusCode: 403 });
    }
  });
};

export default fp(securityPlugin, {
  name: "security",
  dependencies: ["database"],
});
