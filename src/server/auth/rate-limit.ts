import { oneRow, withoutTenant } from '@/lib/db';
import { Errors } from '@/lib/errors';

/**
 * حد التخمين على الدخول مبني على جدول login_attempts في قاعدة البيانات (يصمد أمام إعادة التشغيل
 * وتعدد النسخ). يُحسب للبريد المُدخَل سواء كان موجوداً أم لا، فلا يكشف الرد وجوده.
 */
export const LOGIN_WINDOW_MINUTES = 15;
export const MAX_FAILURES_PER_EMAIL = 8;
export const MAX_FAILURES_PER_IP = 30;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase().slice(0, 254);
}

export async function assertLoginAllowed(email: string, ip: string): Promise<void> {
  const normalized = normalizeEmail(email);
  const row = await withoutTenant((db) =>
    oneRow<{ by_email: string; by_ip: string }>(
      db,
      `SELECT
         count(*) FILTER (WHERE email = $1)::text AS by_email,
         count(*) FILTER (WHERE ip = $2)::text AS by_ip
       FROM login_attempts
       WHERE success = false
         AND created_at > now() - make_interval(mins => $3)
         AND (email = $1 OR ip = $2)`,
      [normalized, ip, LOGIN_WINDOW_MINUTES],
    ),
  );
  const byEmail = Number(row?.by_email ?? 0);
  const byIp = Number(row?.by_ip ?? 0);
  // عند عدم معرفة IP العميل (لا وسيط موثوق) يشترك الجميع بالدلو 'unknown'؛ لا نطبّق حد IP عليه
  // حتى لا يقفل مهاجم واحد الجميع. يبقى حد البريد (لكل حساب) ساري المفعول دائماً.
  const ipBlocked = ip !== 'unknown' && byIp >= MAX_FAILURES_PER_IP;
  if (byEmail >= MAX_FAILURES_PER_EMAIL || ipBlocked) throw Errors.rateLimited();
}

export async function recordLoginAttempt(email: string, ip: string, success: boolean): Promise<void> {
  await withoutTenant(async (db) => {
    await db.query('INSERT INTO login_attempts (email, ip, success) VALUES ($1, $2, $3)', [
      normalizeEmail(email),
      ip,
      success,
    ]);
    // تنظيف انتهازي للسجلات القديمة
    if (Math.random() < 0.02) {
      await db.query("DELETE FROM login_attempts WHERE created_at < now() - interval '2 days'");
    }
  });
}
