import { getEnv, useSecureCookies } from '@/lib/env';

/**
 * كوكي الجلسة: HttpOnly (لا يقرؤه JavaScript)، Secure في production، SameSite=Strict.
 * في الوضع الآمن نستخدم بادئة __Host- التي تُلزم المتصفح بـ Secure + Path=/ + بلا Domain.
 * لا يُخزَّن أي رمز في localStorage إطلاقاً.
 */
export function sessionCookieName(): string {
  return useSecureCookies() ? '__Host-aqarlite_sid' : 'aqarlite_sid';
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function isWellFormedToken(token: string): boolean {
  return TOKEN_RE.test(token);
}

export function readSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const name = sessionCookieName();
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const value = part.slice(index + 1).trim();
    return isWellFormedToken(value) ? value : null;
  }
  return null;
}

export function buildSessionCookie(token: string): string {
  const maxAge = getEnv().SESSION_TTL_HOURS * 3600;
  const attrs = [`${sessionCookieName()}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAge}`];
  if (useSecureCookies()) attrs.push('Secure');
  return attrs.join('; ');
}

export function buildClearedSessionCookie(): string {
  const attrs = [`${sessionCookieName()}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (useSecureCookies()) attrs.push('Secure');
  return attrs.join('; ');
}
