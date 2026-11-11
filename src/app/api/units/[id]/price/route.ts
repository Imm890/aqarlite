import { apiRoute, ok } from '@/server/http';
import { idParam } from '@/server/services/common';
import { updateUnitPrice, updateUnitPriceBody } from '@/server/services/units';

export const dynamic = 'force-dynamic';

export const PATCH = apiRoute({
  permission: 'unit:update_price',
  params: idParam,
  body: updateUnitPriceBody,
  handler: async ({ ctx, params, body, ip }) => ok(await updateUnitPrice(ctx, params.id, body, ip)),
});
