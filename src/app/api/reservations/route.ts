import { apiRoute, created, ok } from '@/server/http';
import {
  createReservationBody,
  listReservations,
  reservationListQuery,
  reserveUnit,
} from '@/server/services/reservations';

export const dynamic = 'force-dynamic';

export const GET = apiRoute({
  permission: ['reservation:read_own', 'reservation:read_all'],
  query: reservationListQuery,
  handler: async ({ ctx, query }) => ok(await listReservations(ctx, query)),
});

export const POST = apiRoute({
  permission: 'reservation:create',
  body: createReservationBody,
  handler: async ({ ctx, body, ip }) => created(await reserveUnit(ctx, body, ip)),
});
