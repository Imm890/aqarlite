import { apiRoute, created, ok } from '@/server/http';
import {
  contractListQuery,
  createContractBody,
  createDraftContract,
  listContracts,
} from '@/server/services/contracts';

export const dynamic = 'force-dynamic';

export const GET = apiRoute({
  permission: ['contract:read_own', 'contract:read_all'],
  query: contractListQuery,
  handler: async ({ ctx, query }) => ok(await listContracts(ctx, query)),
});

export const POST = apiRoute({
  permission: 'contract:create',
  body: createContractBody,
  handler: async ({ ctx, body, ip }) => created(await createDraftContract(ctx, body, ip)),
});
