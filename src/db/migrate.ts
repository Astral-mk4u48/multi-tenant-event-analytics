import fs from "fs";
import path from "path";
import { migrationPool } from "./index";
import { logger } from "../server/logger";
import { fileURLToPath } from "url";

export async function runMigrations() {
  const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

  const client = await migrationPool.connect();
  try {
    for (const file of files) {
      const sqlPath = path.join(migrationsDir, file);
      logger.info({ sqlPath, file }, `Executing database migration: ${file}`);
      const sqlContent = fs.readFileSync(sqlPath, "utf-8");
      await client.query("BEGIN");
      await client.query(sqlContent);
      await client.query("COMMIT");
    }
    logger.info("All database migrations completed successfully");
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
