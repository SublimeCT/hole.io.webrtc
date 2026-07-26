import postgres from "@fastify/postgres";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { Config } from "../config.js";
import { DrizzlePersistence } from "../db/drizzlePersistence.js";
import type { Persistence } from "../db/persistence.js";

declare module "fastify" {
  interface FastifyInstance {
    persistence: Persistence;
  }
}

export interface DatabaseOptions {
  config: Config;
  persistence?: Persistence;
}

const databasePlugin: FastifyPluginAsync<DatabaseOptions> = async (app, opts) => {
  if (opts.persistence !== undefined) {
    app.decorate("persistence", opts.persistence);
    return;
  }
  await app.register(postgres, { connectionString: opts.config.DATABASE_URL });
  app.decorate("persistence", new DrizzlePersistence(app.pg.pool));
};

export default fp(databasePlugin, { name: "database" });
