import { apiRoute, ok } from '@/server/http';
import { idParam } from '@/server/services/common';
import { cancelDraftContract } from '@/server/services/contracts';

export const dynamic = 'force-dynamic';

export const POST = apiRoute({
  permission: 'contract:cancel_own_draft',
  params: idParam,
  handler: async ({ ctx, params, ip }) => ok(await cancelDraftContract(ctx, params.id, ip)),
});
