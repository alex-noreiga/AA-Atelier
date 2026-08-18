// Tiny SQL migration runner. Applies supabase/migrations/*.sql in filename order,
// skipping versions already recorded in schema_migrations. Each file runs inside
// one transaction together with its schema_migrations insert, so a partial apply
// rolls back and the version is only recorded on success.
//
// Runs OUT-OF-BAND (a GitHub Action or by hand) against the DIRECT connection —
// DDL can't traverse Supabase's PgBouncer pooler. Never wired into build:vercel.
//
//   POSTGRES_URL_NON_POOLING=… pnpm --filter @workspace/api-server db:migrate
//
// It is self-contained (imports only `postgres` + node stdlib), so it can be run
// with `node --experimental-strip-types` without the app's build step.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { config } from "dotenv";

// Load a repo-root .env for local runs; a no-op in CI where env comes from secrets.
config({ path: path.resolve(import.meta.dirname, "../../../../.env") });

const MIGRATIONS_DIR = path.resolve(
  import.meta.dirname,
  "../../../../supabase/migrations",
);

async function main(): Promise<void> {
  // Direct (non-pooled) URL for DDL; fall back to POSTGRES_URL if that's all that's set.
  const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
  if (!url) {
    throw new Error(
      "Set POSTGRES_URL_NON_POOLING (preferred) or POSTGRES_URL to run migrations.",
    );
  }

  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });

  try {
    await sql`
      create table if not exists schema_migrations (
        version    text primary key,
        applied_at timestamptz not null default now()
      )`;

    const applied = new Set(
      (
        await sql<{ version: string }[]>`select version from schema_migrations`
      ).map((r) => r.version),
    );

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let ran = 0;
    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      if (applied.has(version)) continue;

      const body = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into schema_migrations (version) values (${version})`;
      });
      // eslint-disable-next-line no-console
      console.log(`applied ${file}`);
      ran++;
    }

    // eslint-disable-next-line no-console
    console.log(
      ran === 0 ? "no pending migrations" : `applied ${ran} migration(s)`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
