import { randomBytes } from 'node:crypto';
import { loadDotEnv, requireEnv } from './lib/env';
import { seed } from './lib/seeder';

loadDotEnv();

async function main(): Promise<void> {
  let password = process.env['SEED_PASSWORD'];
  const generated = !password;
  if (!password) password = randomBytes(12).toString('base64url');

  const accounts = await seed(requireEnv('DATABASE_ADMIN_URL'), password);

  console.log('[seed] done. حسابات تجريبية:');
  for (const a of accounts) console.log(`  ${a.role.padEnd(14)} ${a.email}  (${a.company})`);
  if (generated) console.log(`[seed] كلمة المرور المولَّدة (تُعرض مرة واحدة): ${password}`);
  else console.log('[seed] كلمة المرور = قيمة SEED_PASSWORD في .env');
}

main().catch((error: unknown) => {
  console.error('[seed] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
