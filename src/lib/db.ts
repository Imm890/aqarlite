import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';
import { getEnv } from './env';
import { logger } from './logger';

// DATE يبقى نصاً YYYY-MM-DD كما هو (لا تحويل إلى Date بالتوقيت المحلي فيتحرك اليوم).
types.setTypeParser(types.builtins.DATE, (value: string) => value);

/** أي واجهة تنفّذ استعلامات (عميل داخل معاملة). */
export type Db = Pick<PoolClient, 'query'>;

/** كل ما تحتاجه معاملة المستأجر: الشركة تأتي من الجلسة حصراً. */
export interface TenantRef {
  readonly companyId: string;
}

const globalForPool = globalThis as unknown as {
  __aqarlitePool?: Pool;
  __aqarliteRoleChecked?: Promise<void>;
};

export function getPool(): Pool {
  if (!globalForPool.__aqarlitePool) {
    const env = getEnv();
    const pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: env.DB_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 15_000,
      idle_in_transaction_session_timeout: 30_000,
      application_name: 'aqarlite',
      ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
    });
    pool.on('error', (error) => logger.error('pg pool error', { error }));
    globalForPool.__aqarlitePool = pool;
  }
  return globalForPool.__aqarlitePool;
}

export async function closePool(): Promise<void> {
  const pool = globalForPool.__aqarlitePool;
  globalForPool.__aqarlitePool = undefined;
  globalForPool.__aqarliteRoleChecked = undefined;
  if (pool) await pool.end();
}

export async function rows<R extends QueryResultRow>(
  db: Db,
  text: string,
  params: readonly unknown[] = [],
): Promise<R[]> {
  const result = await db.query<R>(text, [...params]);
  return result.rows;
}

export async function oneRow<R extends QueryResultRow>(
  db: Db,
  text: string,
  params: readonly unknown[] = [],
): Promise<R | undefined> {
  return (await rows<R>(db, text, params))[0];
}

/**
 * عزل المستأجرين لا يعمل إن اتصل التطبيق بدور يتجاوز RLS (superuser/BYPASSRLS/مالك الجداول).
 * نرفض العمل بدور كهذا (إغلاق آمن) بدلاً من العمل بصمت دون حماية قاعدة البيانات.
 */
async function assertSafeDatabaseRole(pool: Pool): Promise<void> {
  const result = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean; owns: boolean }>(
    `SELECT r.rolsuper, r.rolbypassrls,
            EXISTS (SELECT 1 FROM pg_class c WHERE c.relname = 'units' AND c.relowner = r.oid) AS owns
     FROM pg_roles r WHERE r.rolname = current_user`,
  );
  const role = result.rows[0];
  if (!role || role.rolsuper || role.rolbypassrls || role.owns) {
    throw new Error(
      'Unsafe database role: the application must connect as a non-superuser, non-owner role without BYPASSRLS (see README).',
    );
  }
}

function ensureSafeRole(pool: Pool): Promise<void> {
  globalForPool.__aqarliteRoleChecked ??= assertSafeDatabaseRole(pool).catch((error: unknown) => {
    globalForPool.__aqarliteRoleChecked = undefined; // يُعاد الفحص في الطلب التالي
    throw error;
  });
  return globalForPool.__aqarliteRoleChecked;
}

const RETRYABLE_SQLSTATES = new Set(['40001', '40P01']); // serialization_failure, deadlock_detected
const MAX_ATTEMPTS = 3;

function sqlState(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * يشغّل fn داخل معاملة واحدة مقيَّدة بشركة المستخدم:
 *   SELECT set_config('app.company_id', <من الجلسة>, true)
 * فتطبّق سياسات RLS في قاعدة البيانات على كل استعلام داخلها. القيمة محلية للمعاملة
 * (لا تتسرب إلى طلب آخر يعيد استخدام الاتصال). يُعاد المحاولة عند deadlock/serialization.
 */
export async function withTenant<T>(tenant: TenantRef, fn: (db: Db) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(tenant.companyId)) throw new Error('invalid tenant id');
  const pool = getPool();
  await ensureSafeRole(pool);

  for (let attempt = 1; ; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.company_id', $1, true)", [tenant.companyId]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      const state = sqlState(error);
      if (state && RETRYABLE_SQLSTATES.has(state) && attempt < MAX_ATTEMPTS) continue;
      throw error;
    } finally {
      client.release();
    }
  }
}

/** استعلام بلا سياق شركة: لدوال المصادقة (قبل معرفة الشركة) وجدول محاولات الدخول فقط. */
export async function withoutTenant<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const pool = getPool();
  await ensureSafeRole(pool);
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
