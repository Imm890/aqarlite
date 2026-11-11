import { z } from 'zod';
import { can } from '@/domain/permissions';
import { oneRow, rows, withTenant } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { writeAudit } from '../audit';
import type { AuthContext } from '../auth/context';
import { pageQuery, pageSizeQuery, sweepExpiredReservations, toInt, type Page } from './common';

export const createReservationBody = z.strictObject({
  unitId: z.uuid(),
  clientId: z.uuid(),
});
export type CreateReservationBody = z.infer<typeof createReservationBody>;

export const reservationListQuery = z.strictObject({
  status: z.enum(['active', 'expired', 'converted']).optional(),
  page: pageQuery,
  pageSize: pageSizeQuery,
});
export type ReservationListQuery = z.infer<typeof reservationListQuery>;

export interface ReservationDto {
  id: string;
  status: 'active' | 'expired' | 'converted';
  unitId: string;
  unitLabel: string;
  unitPriceCents: number;
  clientId: string;
  clientName: string;
  repId: string;
  repName: string;
  reservedAt: string;
  expiresAt: string;
  /** معرّف العقد الحيّ (مسودة أو معتمد) المرتبط بهذا الحجز إن وُجد */
  contractId: string | null;
}

interface ReservationRow {
  id: string;
  status: ReservationDto['status'];
  unit_id: string;
  project: string;
  number: string;
  unit_price_cents: string;
  client_id: string;
  client_name: string;
  rep_id: string;
  rep_name: string;
  reserved_at: Date;
  expires_at: Date;
  contract_id: string | null;
}

const SELECT = `
  SELECT r.id, r.status, r.unit_id, u.project, u.number, u.price_cents::text AS unit_price_cents, r.client_id, c.name AS client_name,
         r.rep_id, rep.name AS rep_name, r.reserved_at, r.expires_at,
         (SELECT k.id FROM contracts k
           WHERE k.reservation_id = r.id AND k.company_id = r.company_id AND k.status IN ('draft', 'approved')
           LIMIT 1) AS contract_id
  FROM reservations r
  JOIN units u ON u.id = r.unit_id AND u.company_id = r.company_id
  JOIN clients c ON c.id = r.client_id AND c.company_id = r.company_id
  JOIN users rep ON rep.id = r.rep_id AND rep.company_id = r.company_id`;

const toDto = (r: ReservationRow): ReservationDto => ({
  id: r.id,
  status: r.status,
  unitId: r.unit_id,
  unitLabel: `${r.project} — ${r.number}`,
  unitPriceCents: toInt(r.unit_price_cents),
  clientId: r.client_id,
  clientName: r.client_name,
  repId: r.rep_id,
  repName: r.rep_name,
  reservedAt: r.reserved_at.toISOString(),
  expiresAt: r.expires_at.toISOString(),
  contractId: r.contract_id,
});

/**
 * حجز وحدة لعميل المندوب لمدة 72 ساعة.
 *
 * الحجز المتزامن: نقفل صف الوحدة بـ SELECT … FOR UPDATE. مندوبان في اللحظة نفسها يتسلسلان
 * عند هذا القفل؛ الثاني يعيد قراءة الحالة بعد أن يحصل على القفل فيجدها reserved فيُرفض برسالة
 * واضحة (409). وكخط دفاع أخير: فهرس فريد جزئي يسمح بحجز نشط واحد فقط لكل وحدة.
 */
export async function reserveUnit(
  ctx: AuthContext,
  body: CreateReservationBody,
  ip: string,
): Promise<ReservationDto> {
  return withTenant(ctx, async (db) => {
    const unit = await oneRow<{ id: string }>(
      db,
      'SELECT id FROM units WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [body.unitId, ctx.companyId],
    );
    if (!unit) throw Errors.notFound('الوحدة');

    // العميل يجب أن يكون عميل هذا المندوب بالذات (وإلا 404)
    const client = await oneRow<{ id: string }>(
      db,
      'SELECT id FROM clients WHERE id = $1 AND company_id = $2 AND owner_id = $3',
      [body.clientId, ctx.companyId, ctx.userId],
    );
    if (!client) throw Errors.notFound('العميل');

    // حجز سابق منتهٍ على هذه الوحدة يُحرَّر الآن (نحن نمسك قفلها فلا يُتجاوز)
    await sweepExpiredReservations(db);

    const claimed = await oneRow<{ id: string }>(
      db,
      `UPDATE units SET status = 'reserved' WHERE id = $1 AND company_id = $2 AND status = 'available' RETURNING id`,
      [body.unitId, ctx.companyId],
    );
    if (!claimed) throw Errors.unitNotAvailable();

    const reservation = await oneRow<{ id: string }>(
      db,
      `INSERT INTO reservations (company_id, unit_id, client_id, rep_id, reserved_at, expires_at)
       VALUES ($1, $2, $3, $4, now(), now() + interval '72 hours') RETURNING id`,
      [ctx.companyId, body.unitId, body.clientId, ctx.userId],
    );
    if (!reservation) throw Errors.internal();

    await writeAudit(db, {
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'RESERVATION_CREATED',
      entityType: 'reservation',
      entityId: reservation.id,
      details: { unitId: body.unitId, clientId: body.clientId },
      ip,
    });

    const row = await oneRow<ReservationRow>(db, `${SELECT} WHERE r.id = $1 AND r.company_id = $2`, [
      reservation.id,
      ctx.companyId,
    ]);
    if (!row) throw Errors.internal();
    return toDto(row);
  });
}

export async function listReservations(
  ctx: AuthContext,
  query: ReservationListQuery,
): Promise<Page<ReservationDto>> {
  return withTenant(ctx, async (db) => {
    await sweepExpiredReservations(db);

    const params: unknown[] = [ctx.companyId];
    const where = ['r.company_id = $1'];
    if (!can(ctx.role, 'reservation:read_all')) {
      if (!can(ctx.role, 'reservation:read_own')) throw Errors.forbidden();
      params.push(ctx.userId);
      where.push(`r.rep_id = $${params.length}`);
    }
    if (query.status) {
      params.push(query.status);
      where.push(`r.status = $${params.length}`);
    }
    const whereSql = where.join(' AND ');
    const total = await oneRow<{ count: string }>(
      db,
      `SELECT count(*)::text AS count FROM reservations r WHERE ${whereSql}`,
      params,
    );
    const list = await rows<ReservationRow>(
      db,
      `${SELECT} WHERE ${whereSql} ORDER BY r.reserved_at DESC, r.id
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return { items: list.map(toDto), total: toInt(total?.count ?? '0'), page: query.page, pageSize: query.pageSize };
  });
}
