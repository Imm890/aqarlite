import { apiRoute, ok } from '@/server/http';
import { idParam } from '@/server/services/common';
import { getContract } from '@/server/services/contracts';

export const dynamic = 'force-dynamic';

export const GET = apiRoute({
  permission: ['contract:read_own', 'contract:read_all'],
  params: idParam,
  handler: async ({ ctx, params }) => ok(await getContract(ctx, params.id)),
});
