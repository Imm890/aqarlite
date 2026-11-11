import { apiRoute, created, ok } from '@/server/http';
import { clientListQuery, createClient, createClientBody, listClients } from '@/server/services/clients';

export const dynamic = 'force-dynamic';

export const GET = apiRoute({
  permission: ['client:read_own', 'client:read_all'],
  query: clientListQuery,
  handler: async ({ ctx, query }) => ok(await listClients(ctx, query)),
});

export const POST = apiRoute({
  permission: 'client:create',
  body: createClientBody,
  handler: async ({ ctx, body }) => created(await createClient(ctx, body)),
});
