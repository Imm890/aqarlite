import { apiRoute, created, ok } from '@/server/http';
import { createUnit, createUnitBody, listUnits, unitListQuery } from '@/server/services/units';

export const dynamic = 'force-dynamic';

export const GET = apiRoute({
  permission: 'unit:read',
  query: unitListQuery,
  handler: async ({ ctx, query }) => ok(await listUnits(ctx, query)),
});

export const POST = apiRoute({
  permission: 'unit:create',
  body: createUnitBody,
  handler: async ({ ctx, body, ip }) => created(await createUnit(ctx, body, ip)),
});
