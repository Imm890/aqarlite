import { apiRoute, ok } from '@/server/http';
import { auditListQuery, listAuditLogs } from '@/server/audit';

export const dynamic = 'force-dynamic';

export const GET = apiRoute({
  permission: 'audit:read',
  query: auditListQuery,
  handler: async ({ ctx, query }) => ok(await listAuditLogs(ctx, query)),
});
