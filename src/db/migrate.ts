import fs from "fs";
import path from "path";
import { migrationPool } from "./index";
import { logger } from "../server/logger";

export async function runMigrations() {
  const sqlPath = path.join(__dirname, "migrations", "0000_init.sql");
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

if (require.main === module) {
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
