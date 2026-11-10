import { loadDotEnv, requireEnv } from './lib/env';
import { migrate } from './lib/migrator';

loadDotEnv();

const reset = process.argv.includes('--reset');

migrate({
  adminUrl: requireEnv('DATABASE_ADMIN_URL'),
  appDbPassword: process.env['APP_DB_PASSWORD'],
  reset,
  log: (m) => console.log(`[migrate] ${m}`),
})
  .then((applied) => {
    console.log(`[migrate] done (${applied.length} applied)`);
  })
  .catch((error: unknown) => {
    console.error('[migrate] failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
