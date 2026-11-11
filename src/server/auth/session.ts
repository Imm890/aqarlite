import { createHash, randomBytes } from 'node:crypto';
import { isRole } from '@/domain/permissions';
import { oneRow, withoutTenant } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { isWellFormedToken } from './cookies';
import type { AuthContext } from './context';

/**
 * جلسات من جهة الخادم: الرمز عشوائي بـ 256 بت يُرسل في الكوكي فقط، وقاعدة البيانات تحفظ
 * SHA-256 له (فتسريب جدول الجلسات لا يتيح انتحال الجلسات). تسجيل الخروج يضع revoked_at.
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url'); // 43 حرفاً
}

export function hashSessionToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export async function createSession(userId: string): Promise<string> {
  const token = generateSessionToken();
  const ttlSeconds = getEnv().SESSION_TTL_HOURS * 3600;
  await withoutTenant((db) =>
    db.query('SELECT auth_create_session($1, $2, $3)', [userId, hashSessionToken(token), ttlSeconds]),
  );
  return token;
}

interface ResolvedRow {
  session_id: string;
  user_id: string;
  company_id: string;
  role: string;
  name: string;
  email: string;
}

/** يتحقق من الرمز في قاعدة البيانات (غير ملغى/منتهٍ/خامل، المستخدم فعّال). null إن لم يصلح. */
export async function resolveSession(token: string | null): Promise<AuthContext | null> {
  if (!token || !isWellFormedToken(token)) return null;
  const idleSeconds = getEnv().SESSION_IDLE_MINUTES * 60;
  const row = await withoutTenant((db) =>
    oneRow<ResolvedRow>(db, 'SELECT * FROM auth_resolve_session($1, $2)', [hashSessionToken(token), idleSeconds]),
  );
  if (!row || !isRole(row.role)) return null;
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    companyId: row.company_id,
    role: row.role,
    name: row.name,
    email: row.email,
  };
}

/** إبطال فعلي في الخادم — حذف الكوكي من المتصفح وحده لا يكفي. */
export async function revokeSession(token: string): Promise<void> {
  if (!isWellFormedToken(token)) return;
  await withoutTenant((db) => db.query('SELECT auth_revoke_session($1)', [hashSessionToken(token)]));
}
