import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const MIGRATIONS_DIR = join(process.cwd(), 'migrations');
const ADVISORY_LOCK_KEY = 727_274;

export interface MigrateOptions {
  adminUrl: string;
  /** كلمة مرور دور التطبيق aqarlite_app */
  appDbPassword?: string | undefined;
  /** يحذف كل شيء ويبدأ من الصفر — للتطوير والاختبار فقط */
  reset?: boolean;
  log?: (message: string) => void;
}

export async function migrate(options: MigrateOptions): Promise<string[]> {
  const log = options.log ?? ((): void => undefined);
  if (options.reset && process.env['NODE_ENV'] === 'production') {
    throw new Error('Refusing to reset the database when NODE_ENV=production');
  }

  const client = new Client({ connectionString: options.adminUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);

    if (options.reset) {
      log('reset: dropping schema public');
      await client.query('DROP SCHEMA IF EXISTS public CASCADE');
      await client.query('CREATE SCHEMA public');
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);

    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
    );
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d+_.+\.sql$/.test(f))
      .sort();

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      log(`applying ${file}`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    if (options.appDbPassword) {
      // format(%L) يقتبس القيمة بأمان؛ ALTER ROLE لا يقبل معاملات مرتبطة
      const stmt = await client.query<{ stmt: string }>(
        `SELECT format('ALTER ROLE aqarlite_app WITH LOGIN PASSWORD %L', $1::text) AS stmt`,
        [options.appDbPassword],
      );
      await client.query(stmt.rows[0]?.stmt ?? '');
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
  return applied;
}
