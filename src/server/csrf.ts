import { getEnv } from '@/lib/env';
import { Errors } from '@/lib/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * حماية CSRF طبقات متعددة:
 *  1) كوكي الجلسة SameSite=Strict (لا يُرسل في طلبات عبر المواقع).
 *  2) في كل طلب يغيّر حالة نشترط ترويسة Origin مطابقة لعنوان التطبيق المُعلَن (APP_URL).
 *  3) إن وُجدت Sec-Fetch-Site فيجب أن تكون same-origin.
 *  4) نقبل JSON فقط (Content-Type: application/json)، وهو ما لا ترسله نماذج HTML عبر المواقع.
 */
export function assertSameOrigin(req: Request): void {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return;
  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') throw Errors.forbidden();
  const origin = req.headers.get('origin');
  if (!origin) throw Errors.forbidden();
  let expected: string;
  try {
    expected = new URL(getEnv().APP_URL).origin;
  } catch {
    throw Errors.forbidden();
  }
  if (origin !== expected) throw Errors.forbidden();
}
