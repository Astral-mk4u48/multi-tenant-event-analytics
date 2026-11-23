import fs from "fs";
import path from "path";
import { migrationPool } from "./index";
import { logger } from "../server/logger";

import { fileURLToPath } from "url";

export async function runMigrations() {
  const sqlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations", "0000_init.sql");
  logger.info({ sqlPath }, "Reading migration file");
  const sqlContent = fs.readFileSync(sqlPath, "utf-8");

  const client = await migrationPool.connect();
  try {
    logger.info("Executing database migration via migrationPool (superuser)...");
    await client.query("BEGIN");
    await client.query(sqlContent);
    await client.query("COMMIT");
    logger.info("Migration completed successfully");
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error({ error }, "Migration failed");
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations()
    .then(() => {
      migrationPool.end();
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      migrationPool.end();
      process.exit(1);
    });
}
