import { z } from 'zod';
import { MAX_AMOUNT_CENTS } from '@/domain/money';
import { oneRow, rows, withTenant } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { writeAudit } from '../audit';
import type { AuthContext } from '../auth/context';
import {
  centsQuery,
  pageQuery,
  pageSizeQuery,
  sweepExpiredReservations,
  toInt,
  type Page,
} from './common';

export const UNIT_TYPES = ['apartment', 'villa', 'townhouse', 'duplex', 'office', 'shop'] as const;
export const UNIT_STATUSES = ['available', 'reserved', 'sold'] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

export interface UnitDto {
  id: string;
  project: string;
  number: string;
  type: (typeof UNIT_TYPES)[number];
  areaSqm: number;
  rooms: number;
  priceCents: number;
  status: UnitStatus;
  createdAt: string;
}

// ───────────── المخططات (تحقق صارم من كل مُدخل) ─────────────
export const unitListQuery = z
  .strictObject({
    status: z.enum(UNIT_STATUSES).optional(),
    minPriceCents: centsQuery.optional(),
    maxPriceCents: centsQuery.optional(),
    sort: z.enum(['price', 'area']).default('price'),
    order: z.enum(['asc', 'desc']).default('asc'),
    page: pageQuery,
    pageSize: pageSizeQuery,
  })
  .refine(
    (q) => q.minPriceCents === undefined || q.maxPriceCents === undefined || q.minPriceCents <= q.maxPriceCents,
    { message: 'الحد الأدنى للسعر يجب ألا يتجاوز الحد الأعلى.', path: ['minPriceCents'] },
  );
export type UnitListQuery = z.infer<typeof unitListQuery>;

const text = (max: number): z.ZodString => z.string().trim().min(1).max(max);

export const createUnitBody = z.strictObject({
  project: text(120),
  number: text(40),
  type: z.enum(UNIT_TYPES),
  areaSqm: z
    .number()
    .positive()
    .lt(1_000_000)
    .refine((n) => /^\d+(\.\d{1,2})?$/.test(String(n)), 'المساحة بحد أقصى خانتين عشريتين.'),
  rooms: z.number().int().min(0).max(30),
  priceCents: z.number().int().min(1).max(MAX_AMOUNT_CENTS),
});
export type CreateUnitBody = z.infer<typeof createUnitBody>;

export const updateUnitPriceBody = z.strictObject({
  priceCents: z.number().int().min(1).max(MAX_AMOUNT_CENTS),
});
export type UpdateUnitPriceBody = z.infer<typeof updateUnitPriceBody>;

// ───────────── الصفوف ─────────────
interface UnitRow {
  id: string;
  project: string;
  number: string;
  type: UnitDto['type'];
  area_sqm: string;
  rooms: number;
  price_cents: string;
  status: UnitStatus;
  created_at: Date;
}

const UNIT_COLUMNS = `u.id, u.project, u.number, u.type, u.area_sqm::text AS area_sqm, u.rooms,
  u.price_cents::text AS price_cents, u.status, u.created_at`;

function toDto(r: UnitRow): UnitDto {
  return {
    id: r.id,
    project: r.project,
    number: r.number,
    type: r.type,
    areaSqm: Number(r.area_sqm),
    rooms: r.rooms,
    priceCents: toInt(r.price_cents),
    status: r.status,
    createdAt: r.created_at.toISOString(),
  };
}

/** أعمدة الترتيب من قائمة بيضاء ثابتة؛ لا يُدمَج أي نص من المستخدم في SQL. */
const SORT_COLUMNS = { price: 'u.price_cents', area: 'u.area_sqm' } as const;

export async function listUnits(ctx: AuthContext, query: UnitListQuery): Promise<Page<UnitDto>> {
  return withTenant(ctx, async (db) => {
    await sweepExpiredReservations(db);

    const params: unknown[] = [ctx.companyId];
    const where: string[] = ['u.company_id = $1'];
    if (query.status) {
      params.push(query.status);
      where.push(`u.status = $${params.length}`);
    }
    if (query.minPriceCents !== undefined) {
      params.push(query.minPriceCents);
      where.push(`u.price_cents >= $${params.length}`);
    }
    if (query.maxPriceCents !== undefined) {
      params.push(query.maxPriceCents);
      where.push(`u.price_cents <= $${params.length}`);
    }
    const whereSql = where.join(' AND ');
    const direction = query.order === 'desc' ? 'DESC' : 'ASC';

    const total = await oneRow<{ count: string }>(
      db,
      `SELECT count(*)::text AS count FROM units u WHERE ${whereSql}`,
      params,
    );
    const offset = (query.page - 1) * query.pageSize;
    const list = await rows<UnitRow>(
      db,
      `SELECT ${UNIT_COLUMNS} FROM units u
       WHERE ${whereSql}
       ORDER BY ${SORT_COLUMNS[query.sort]} ${direction}, u.id ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, offset],
    );
    return {
      items: list.map(toDto),
      total: toInt(total?.count ?? '0'),
      page: query.page,
      pageSize: query.pageSize,
    };
  });
}

export async function createUnit(ctx: AuthContext, body: CreateUnitBody, ip: string): Promise<UnitDto> {
  return withTenant(ctx, async (db) => {
    const row = await oneRow<UnitRow>(
      db,
      `INSERT INTO units (company_id, project, number, type, area_sqm, rooms, price_cents, created_by)
       VALUES ($1, $2, $3, $4, $5::numeric, $6, $7, $8)
       RETURNING id, project, number, type, area_sqm::text AS area_sqm, rooms,
                 price_cents::text AS price_cents, status, created_at`,
      [ctx.companyId, body.project, body.number, body.type, body.areaSqm, body.rooms, body.priceCents, ctx.userId],
    );
    if (!row) throw Errors.internal();
    await writeAudit(db, {
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'UNIT_CREATED',
      entityType: 'unit',
      entityId: row.id,
      details: { project: body.project, number: body.number, priceCents: body.priceCents },
      ip,
    });
    return toDto(row);
  });
}

/**
 * تعديل السعر: مسموح فقط لوحدة available. نقفل الصف أولاً (FOR UPDATE) فلا يمكن أن يحجزها
 * أحد بين الفحص والتعديل. التعارض مع الحجز المتزامن يُحسم بالقفل لا بالحظ.
 */
export async function updateUnitPrice(
  ctx: AuthContext,
  unitId: string,
  body: UpdateUnitPriceBody,
  ip: string,
): Promise<UnitDto> {
  return withTenant(ctx, async (db) => {
    const locked = await oneRow<{ id: string }>(
      db,
      'SELECT id FROM units WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [unitId, ctx.companyId],
    );
    if (!locked) throw Errors.notFound('الوحدة');
    await sweepExpiredReservations(db); // حجز منتهٍ يُحرّر الوحدة قبل الفحص

    const current = await oneRow<UnitRow>(
      db,
      `SELECT ${UNIT_COLUMNS} FROM units u WHERE u.id = $1 AND u.company_id = $2`,
      [unitId, ctx.companyId],
    );
    if (!current) throw Errors.notFound('الوحدة');
    if (current.status !== 'available') throw Errors.unitLockedForPrice();

    const oldPrice = toInt(current.price_cents);
    if (oldPrice === body.priceCents) return toDto(current);

    const updated = await oneRow<UnitRow>(
      db,
      `UPDATE units u SET price_cents = $3 WHERE u.id = $1 AND u.company_id = $2
       RETURNING ${UNIT_COLUMNS}`,
      [unitId, ctx.companyId, body.priceCents],
    );
    if (!updated) throw Errors.internal();
    await writeAudit(db, {
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'UNIT_PRICE_CHANGED',
      entityType: 'unit',
      entityId: unitId,
      details: { oldPriceCents: oldPrice, newPriceCents: body.priceCents },
      ip,
    });
    return toDto(updated);
  });
}
