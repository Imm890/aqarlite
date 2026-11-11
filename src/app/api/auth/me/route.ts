import { apiRoute, ok } from '@/server/http';

export const dynamic = 'force-dynamic';

export const GET = apiRoute({
  permission: 'authenticated',
  handler: async ({ ctx }) =>
    ok({ user: { id: ctx.userId, name: ctx.name, email: ctx.email, role: ctx.role } }),
});
