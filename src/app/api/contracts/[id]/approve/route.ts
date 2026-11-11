import { apiRoute, ok } from '@/server/http';
import { idParam } from '@/server/services/common';
import { approveContract } from '@/server/services/contracts';

export const dynamic = 'force-dynamic';

export const POST = apiRoute({
  permission: 'contract:approve',
  params: idParam,
  handler: async ({ ctx, params, ip }) => ok(await approveContract(ctx, params.id, ip)),
});
