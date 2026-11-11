import { buildSessionCookie } from '@/server/auth/cookies';
import { login, loginBody } from '@/server/auth/login';
import { ok, publicRoute } from '@/server/http';

export const dynamic = 'force-dynamic';

export const POST = publicRoute({
  body: loginBody,
  handler: async ({ body, ip }) => {
    const result = await login(body, ip);
    return ok({ user: result.user }, { setCookies: [buildSessionCookie(result.token)] });
  },
});
