import { buildClearedSessionCookie } from '@/server/auth/cookies';
import { logout } from '@/server/auth/login';
import { apiRoute, ok } from '@/server/http';

export const dynamic = 'force-dynamic';

export const POST = apiRoute({
  permission: 'authenticated',
  handler: async ({ ctx, token, ip }) => {
    await logout(ctx, token, ip); // إبطال الجلسة في قاعدة البيانات فعلياً
    return ok({ ok: true }, { setCookies: [buildClearedSessionCookie()] });
  },
});
