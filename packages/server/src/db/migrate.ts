import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { loadConfig } from "../config.js";

const config = loadConfig();
const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 1,
});

try {
  await migrate(drizzle(pool), {
    migrationsFolder: resolve(import.meta.dirname, "../drizzle"),
  });
} finally {
  await pool.end();
}
