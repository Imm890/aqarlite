import { migrate } from '../../scripts/lib/migrator';
import { seed } from '../../scripts/lib/seeder';

export const TEST_PASSWORD = 'Test-Passw0rd-2026!';

/** قاعدة اختبار نظيفة: تُنشأ migrations كاملة ثم seed، مرة واحدة قبل كل الاختبارات. */
export default async function setup(): Promise<void> {
  const host = process.env['TEST_DB_HOST'] ?? '127.0.0.1:5432';
  const adminUrl = process.env['TEST_DATABASE_ADMIN_URL'] ?? `postgres://postgres@${host}/aqarlite_test`;
  await migrate({
    adminUrl,
    appDbPassword: process.env['APP_DB_PASSWORD'] ?? 'change-me-app-password',
    reset: true,
  });
  await seed(adminUrl, TEST_PASSWORD);
}
