import { apiRoute, ok } from '@/server/http';
import { getProfile } from '@/server/services/profile';

export const dynamic = 'force-dynamic';

export const GET = apiRoute({
  permission: 'authenticated',
  handler: async ({ ctx }) => ok(await getProfile(ctx)),
});
