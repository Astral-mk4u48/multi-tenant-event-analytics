import pg from "pg";

async function initCiDb() {
  const dbUrl = process.env.DATABASE_MIGRATION_URL || "postgres://postgres:pass@localhost:5432/analytics";
  const client = new pg.Client(dbUrl);

  await client.connect();

  await client.query(`
    DO $$ BEGIN
      CREATE ROLE app_user WITH LOGIN PASSWORD 'pass';
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
    GRANT CONNECT ON DATABASE analytics TO app_user;
    GRANT USAGE ON SCHEMA public TO app_user;
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_user;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_user;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_user;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO app_user;
  `);

  await client.end();
  console.log("CI Database app_user role and permissions initialized successfully.");
}

initCiDb().catch((err) => {
  console.error("Failed to initialize CI database:", err);
  process.exit(1);
});
