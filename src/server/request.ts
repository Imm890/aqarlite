import { getEnv } from '@/lib/env';

/**
 * عنوان العميل. ترويسة X-Forwarded-For قابلة للتزييف من المهاجم، فلا نثق بها إلا بقدر
 * عدد الوسطاء الموثوقين المُعلَن (TRUST_PROXY_HOPS): نأخذ العنصر رقم N من اليمين، وهو
 * ما أضافه آخر وسيط موثوق، لا ما كتبه العميل. عند 0 لا نثق بأي ترويسة.
 */
export function getClientIp(req: Request): string {
  const hops = getEnv().TRUST_PROXY_HOPS;
  if (hops === 0) return 'unknown';
  const forwarded = req.headers.get('x-forwarded-for');
  if (!forwarded) return 'unknown';
  const parts = forwarded
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const candidate = parts[parts.length - hops];
  if (!candidate || candidate.length > 64 || !/^[0-9a-fA-F:.]+$/.test(candidate)) return 'unknown';
  return candidate;
}
