import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

async function start(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp({ config });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    app.log.info(`server listening on http://${config.HOST}:${config.PORT}`);
  } catch (err) {
    app.log.error({ err }, "listen failed");
    process.exit(1);
  }
}

void start();
