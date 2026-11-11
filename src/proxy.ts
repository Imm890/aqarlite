import { NextResponse, type NextRequest } from 'next/server';

/**
 * يعمل قبل كل طلب صفحة:
 *  • يولّد nonce جديداً ويضبط Content-Security-Policy صارمة (لا inline scripts بلا nonce،
 *    لا eval في production، لا frames، لا مصادر خارجية) = خط دفاع ثانٍ ضد XSS.
 *  • يحوّل غير المسجّلين إلى /login (فحص تجميلي سريع بوجود الكوكي فقط؛ التحقق الحقيقي من
 *    الجلسة يجري في الخادم عند كل طلب بيانات، وفي طبقة الصفحات عبر requireSession()).
 */
const SESSION_COOKIES = ['__Host-aqarlite_sid', 'aqarlite_sid'];

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const hasCookie = SESSION_COOKIES.some((name) => request.cookies.has(name));

  if (!hasCookie && pathname !== '/login') {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // كل المسارات عدا API (تحميها apiRoute بنفسها) وملفات Next الثابتة
  matcher: [{ source: '/((?!api|_next/static|_next/image|favicon.ico).*)', missing: [{ type: 'header', key: 'next-router-prefetch' }] }],
};
