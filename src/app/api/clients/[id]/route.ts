import { apiRoute, ok } from '@/server/http';
import { getClient } from '@/server/services/clients';
import { idParam } from '@/server/services/common';

export const dynamic = 'force-dynamic';

export const GET = apiRoute({
  permission: ['client:read_own', 'client:read_all'],
  params: idParam,
  handler: async ({ ctx, params }) => ok(await getClient(ctx, params.id)),
});
