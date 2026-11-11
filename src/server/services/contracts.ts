import { z } from 'zod';
import { isValidIsoDate, todayInTimeZone, type IsoDate } from '@/domain/dates';
import { addMonthsClamped } from '@/domain/dates';
import { generateSchedule, MAX_INSTALLMENTS, type InstallmentKind } from '@/domain/installments';
import { isFinalPriceWithinDiscount } from '@/domain/money';
import { displayStatus, type InstallmentStatus } from '@/domain/payments';
import { can } from '@/domain/permissions';
import { oneRow, rows, withTenant, type Db } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { writeAudit } from '../audit';
import type { AuthContext } from '../auth/context';
import { centsBody, pageQuery, pageSizeQuery, positiveCentsBody, sweepExpiredReservations, toInt, type Page } from './common';

// ───────────── المخططات ─────────────
export const createContractBody = z.strictObject({
  reservationId: z.uuid(),
  finalPriceCents: positiveCentsBody,
  downPaymentCents: centsBody,
  installmentsCount: z.number().int().min(1).max(MAX_INSTALLMENTS),
  startDate: z.string().refine(isValidIsoDate, 'تاريخ غير صالح (الصيغة YYYY-MM-DD).'),
});
export type CreateContractBody = z.infer<typeof createContractBody>;

export const contractListQuery = z.strictObject({
  status: z.enum(['draft', 'approved', 'cancelled']).optional(),
  page: pageQuery,
  pageSize: pageSizeQuery,
});
export type ContractListQuery = z.infer<typeof contractListQuery>;

// ───────────── DTOs ─────────────
export interface InstallmentDto {
  id: string;
  sequence: number;
  kind: InstallmentKind;
  dueDate: IsoDate;
  amountCents: number;
  paidCents: number;
  remainingCents: number;
  status: InstallmentStatus;
}

export interface ContractPaymentDto {
  id: string;
  amountCents: number;
  createdAt: string;
  recordedByName: string;
  allocations: { sequence: number; amountCents: number }[];
}

export interface ContractSummaryDto {
  id: string;
  status: 'draft' | 'approved' | 'cancelled';
  unitId: string;
  unitLabel: string;
  clientId: string;
  clientName: string;
  repId: string;
  repName: string;
  finalPriceCents: number;
  paidCents: number;
  remainingCents: number;
  startDate: IsoDate;
  createdAt: string;
  approvedAt: string | null;
}

export interface ContractDetailDto extends ContractSummaryDto {
  unitPriceCents: number;
  discountCents: number;
  downPaymentCents: number;
  installmentsCount: number;
  clientPhone: string;
  approvedByName: string | null;
  /** مسودة: الجدول معروض كمعاينة محسوبة ولم يُحفظ بعد (يُولَّد عند الاعتماد) */
  schedulePreview: boolean;
  installments: InstallmentDto[];
  payments: ContractPaymentDto[];
  overdueCents: number;
  today: IsoDate;
}

interface ContractRow {
  id: string;
  status: ContractSummaryDto['status'];
  unit_id: string;
  project: string;
  number: string;
  client_id: string;
  client_name: string;
  client_phone: string;
  rep_id: string;
  rep_name: string;
  unit_price_cents: string;
  final_price_cents: string;
  down_payment_cents: string;
  installments_count: number;
  start_date: string;
  paid_cents: string;
  created_at: Date;
  approved_at: Date | null;
  approved_by_name: string | null;
}

const SELECT = `
  SELECT k.id, k.status, k.unit_id, u.project, u.number, k.client_id, c.name AS client_name, c.phone AS client_phone,
         k.rep_id, rep.name AS rep_name, k.unit_price_cents::text, k.final_price_cents::text,
         k.down_payment_cents::text, k.installments_count, k.start_date, k.created_at, k.approved_at,
         appr.name AS approved_by_name,
         COALESCE((SELECT sum(i.paid_cents) FROM installments i
                    WHERE i.contract_id = k.id AND i.company_id = k.company_id), 0)::text AS paid_cents
  FROM contracts k
  JOIN units u ON u.id = k.unit_id AND u.company_id = k.company_id
  JOIN clients c ON c.id = k.client_id AND c.company_id = k.company_id
  JOIN users rep ON rep.id = k.rep_id AND rep.company_id = k.company_id
  LEFT JOIN users appr ON appr.id = k.approved_by AND appr.company_id = k.company_id`;

function summarize(r: ContractRow): ContractSummaryDto {
  const final = toInt(r.final_price_cents);
  const paid = toInt(r.paid_cents);
  return {
    id: r.id,
    status: r.status,
    unitId: r.unit_id,
    unitLabel: `${r.project} — ${r.number}`,
    clientId: r.client_id,
    clientName: r.client_name,
    repId: r.rep_id,
    repName: r.rep_name,
    finalPriceCents: final,
    paidCents: paid,
    remainingCents: final - paid,
    startDate: r.start_date,
    createdAt: r.created_at.toISOString(),
    approvedAt: r.approved_at ? r.approved_at.toISOString() : null,
  };
}

/** المندوب يرى عقوده فقط؛ المدير والمحاسب يريان كل عقود الشركة. */
function scope(ctx: AuthContext, params: unknown[]): string {
  params.push(ctx.companyId);
  let sql = `k.company_id = $${params.length}`;
  if (!can(ctx.role, 'contract:read_all')) {
    if (!can(ctx.role, 'contract:read_own')) throw Errors.forbidden();
    params.push(ctx.userId);
    sql += ` AND k.rep_id = $${params.length}`;
  }
  return sql;
}

async function companyToday(db: Db, companyId: string): Promise<IsoDate> {
  const row = await oneRow<{ timezone: string }>(db, 'SELECT timezone FROM companies WHERE id = $1', [companyId]);
  return todayInTimeZone(row?.timezone ?? 'UTC');
}

// ───────────── القراءة ─────────────
export async function loadContract(db: Db, ctx: AuthContext, contractId: string): Promise<ContractDetailDto> {
  const params: unknown[] = [];
  const scopeSql = scope(ctx, params);
  params.push(contractId);
  const row = await oneRow<ContractRow>(db, `${SELECT} WHERE ${scopeSql} AND k.id = $${params.length}`, params);
  if (!row) throw Errors.notFound('العقد');

  const today = await companyToday(db, ctx.companyId);
  const summary = summarize(row);
  const finalPrice = summary.finalPriceCents;
  const unitPrice = toInt(row.unit_price_cents);
  const down = toInt(row.down_payment_cents);

  let installments: InstallmentDto[];
  let schedulePreview = false;
  if (row.status === 'approved') {
    const list = await rows<{
      id: string;
      sequence: number;
      kind: InstallmentKind;
      due_date: string;
      amount_cents: string;
      paid_cents: string;
    }>(
      db,
      `SELECT id, sequence, kind, due_date, amount_cents::text, paid_cents::text
       FROM installments WHERE contract_id = $1 AND company_id = $2 ORDER BY due_date, sequence`,
      [contractId, ctx.companyId],
    );
    installments = list.map((i) => {
      const amountCents = toInt(i.amount_cents);
      const paidCents = toInt(i.paid_cents);
      return {
        id: i.id,
        sequence: i.sequence,
        kind: i.kind,
        dueDate: i.due_date,
        amountCents,
        paidCents,
        remainingCents: amountCents - paidCents,
        status: displayStatus({ amountCents, paidCents, dueDate: i.due_date }, today),
      };
    });
  } else if (row.status === 'draft') {
    schedulePreview = true;
    installments = generateSchedule({
      finalPriceCents: finalPrice,
      downPaymentCents: down,
      installmentsCount: row.installments_count,
      startDate: row.start_date,
    }).map((s) => ({
      id: `preview-${s.sequence}`,
      sequence: s.sequence,
      kind: s.kind,
      dueDate: s.dueDate,
      amountCents: s.amountCents,
      paidCents: 0,
      remainingCents: s.amountCents,
      status: 'pending',
    }));
  } else {
    installments = [];
  }

  const paymentRows = await rows<{
    id: string;
    amount_cents: string;
    created_at: Date;
    recorded_by_name: string;
  }>(
    db,
    `SELECT p.id, p.amount_cents::text, p.created_at, u.name AS recorded_by_name
     FROM payments p JOIN users u ON u.id = p.recorded_by AND u.company_id = p.company_id
     WHERE p.contract_id = $1 AND p.company_id = $2 ORDER BY p.created_at, p.id`,
    [contractId, ctx.companyId],
  );
  const allocationRows =
    paymentRows.length === 0
      ? []
      : await rows<{ payment_id: string; sequence: number; amount_cents: string }>(
          db,
          `SELECT a.payment_id, i.sequence, a.amount_cents::text
           FROM payment_allocations a JOIN installments i ON i.id = a.installment_id AND i.company_id = a.company_id
           WHERE a.contract_id = $1 AND a.company_id = $2 ORDER BY i.sequence`,
          [contractId, ctx.companyId],
        );
  const payments: ContractPaymentDto[] = paymentRows.map((p) => ({
    id: p.id,
    amountCents: toInt(p.amount_cents),
    createdAt: p.created_at.toISOString(),
    recordedByName: p.recorded_by_name,
    allocations: allocationRows
      .filter((a) => a.payment_id === p.id)
      .map((a) => ({ sequence: a.sequence, amountCents: toInt(a.amount_cents) })),
  }));

  const overdueCents = installments
    .filter((i) => i.status === 'overdue')
    .reduce((total, i) => total + i.remainingCents, 0);

  return {
    ...summary,
    unitPriceCents: unitPrice,
    discountCents: unitPrice - finalPrice,
    downPaymentCents: down,
    installmentsCount: row.installments_count,
    clientPhone: row.client_phone,
    approvedByName: row.approved_by_name,
    schedulePreview,
    installments,
    payments,
    overdueCents,
    today,
  };
}

export async function getContract(ctx: AuthContext, contractId: string): Promise<ContractDetailDto> {
  return withTenant(ctx, async (db) => {
    await sweepExpiredReservations(db);
    return loadContract(db, ctx, contractId);
  });
}

export async function listContracts(ctx: AuthContext, query: ContractListQuery): Promise<Page<ContractSummaryDto>> {
  return withTenant(ctx, async (db) => {
    await sweepExpiredReservations(db);
    const params: unknown[] = [];
    const where = [scope(ctx, params)];
    if (query.status) {
      params.push(query.status);
      where.push(`k.status = $${params.length}`);
    }
    const whereSql = where.join(' AND ');
    const total = await oneRow<{ count: string }>(
      db,
      `SELECT count(*)::text AS count FROM contracts k WHERE ${whereSql}`,
      params,
    );
    const list = await rows<ContractRow>(
      db,
      `${SELECT} WHERE ${whereSql} ORDER BY k.created_at DESC, k.id
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return { items: list.map(summarize), total: toInt(total?.count ?? '0'), page: query.page, pageSize: query.pageSize };
  });
}

// ───────────── الإنشاء (مسودة) ─────────────
type Outcome = { kind: 'ok'; contract: ContractDetailDto } | { kind: 'reservation_inactive' };

/**
 * المندوب ينشئ مسودة عقد من حجز نشط يملكه. ترتيب الأقفال: الوحدة ← الحجز.
 * نرجع نتيجة (لا نرمي) عند انتهاء الحجز كي يُثبَّت تحرير الوحدة (COMMIT) ثم نرمي بعد المعاملة.
 */
export async function createDraftContract(
  ctx: AuthContext,
  body: CreateContractBody,
  ip: string,
): Promise<ContractDetailDto> {
  const outcome = await withTenant(ctx, async (db): Promise<Outcome> => {
    const owned = await oneRow<{ unit_id: string }>(
      db,
      'SELECT unit_id FROM reservations WHERE id = $1 AND company_id = $2 AND rep_id = $3',
      [body.reservationId, ctx.companyId, ctx.userId],
    );
    if (!owned) throw Errors.notFound('الحجز');

    await db.query('SELECT 1 FROM units WHERE id = $1 AND company_id = $2 FOR UPDATE', [owned.unit_id, ctx.companyId]);
    await sweepExpiredReservations(db);

    const reservation = await oneRow<{ status: string; expires_live: boolean }>(
      db,
      `SELECT status, (expires_at > now()) AS expires_live FROM reservations
       WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [body.reservationId, ctx.companyId],
    );
    if (!reservation || reservation.status !== 'active' || !reservation.expires_live) {
      return { kind: 'reservation_inactive' };
    }

    const unit = await oneRow<{ price_cents: string; status: string }>(
      db,
      'SELECT price_cents::text, status FROM units WHERE id = $1 AND company_id = $2',
      [owned.unit_id, ctx.companyId],
    );
    if (!unit || unit.status !== 'reserved') return { kind: 'reservation_inactive' };
    const unitPrice = toInt(unit.price_cents);

    if (!isFinalPriceWithinDiscount(unitPrice, body.finalPriceCents)) throw Errors.discountTooHigh();

    const today = await companyToday(db, ctx.companyId);
    const latest = addMonthsClamped(today, 12);
    if (body.startDate < today || body.startDate > latest) {
      throw Errors.validation({ startDate: 'تاريخ البداية يجب أن يكون من اليوم وحتى سنة قادمة.' });
    }
    // يتحقق من جدوى الجدول (الدفعة الأولى، عدد الأقساط…) برسائل حقول واضحة؛ يُحفظ عند الاعتماد
    generateSchedule({
      finalPriceCents: body.finalPriceCents,
      downPaymentCents: body.downPaymentCents,
      installmentsCount: body.installmentsCount,
      startDate: body.startDate,
    });

    const inserted = await oneRow<{ id: string }>(
      db,
      `INSERT INTO contracts (company_id, reservation_id, unit_id, client_id, rep_id,
                              unit_price_cents, final_price_cents, down_payment_cents,
                              installments_count, start_date)
       SELECT r.company_id, r.id, r.unit_id, r.client_id, r.rep_id, $3, $4, $5, $6, $7
       FROM reservations r WHERE r.id = $1 AND r.company_id = $2
       RETURNING id`,
      [
        body.reservationId,
        ctx.companyId,
        unitPrice,
        body.finalPriceCents,
        body.downPaymentCents,
        body.installmentsCount,
        body.startDate,
      ],
    );
    if (!inserted) throw Errors.internal();

    await writeAudit(db, {
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'CONTRACT_CREATED',
      entityType: 'contract',
      entityId: inserted.id,
      details: { reservationId: body.reservationId, finalPriceCents: body.finalPriceCents },
      ip,
    });
    return { kind: 'ok', contract: await loadContract(db, ctx, inserted.id) };
  });

  if (outcome.kind === 'reservation_inactive') throw Errors.reservationExpired();
  return outcome.contract;
}

export async function cancelDraftContract(ctx: AuthContext, contractId: string, ip: string): Promise<ContractDetailDto> {
  return withTenant(ctx, async (db) => {
    const row = await oneRow<{ status: string }>(
      db,
      'SELECT status FROM contracts WHERE id = $1 AND company_id = $2 AND rep_id = $3 FOR UPDATE',
      [contractId, ctx.companyId, ctx.userId],
    );
    if (!row) throw Errors.notFound('العقد');
    if (row.status !== 'draft') throw Errors.contractNotDraft();
    await db.query(`UPDATE contracts SET status = 'cancelled' WHERE id = $1 AND company_id = $2`, [
      contractId,
      ctx.companyId,
    ]);
    await writeAudit(db, {
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'CONTRACT_CANCELLED',
      entityType: 'contract',
      entityId: contractId,
      ip,
    });
    return loadContract(db, ctx, contractId);
  });
}

// ───────────── الاعتماد ─────────────
interface LockedContract {
  id: string;
  status: string;
  reservation_id: string;
  unit_id: string;
  unit_price_cents: string;
  final_price_cents: string;
  down_payment_cents: string;
  installments_count: number;
  start_date: string;
}

type ApproveOutcome = { kind: 'ok'; contract: ContractDetailDto } | { kind: 'reservation_inactive' };

/**
 * المحاسب يعتمد العقد. كل شيء في معاملة واحدة (كل شيء أو لا شيء):
 *   الوحدة reserved→sold، الحجز → converted، العقد → approved، وتوليد الأقساط، وسجل التدقيق.
 * ترتيب الأقفال: الوحدة ← الحجز ← العقد (نفس ترتيب بقية المسارات فلا deadlock).
 * بعد الاعتماد لا يُعدَّل العقد (محفّز في قاعدة البيانات يرفض أي تعديل).
 */
export async function approveContract(ctx: AuthContext, contractId: string, ip: string): Promise<ContractDetailDto> {
  const outcome = await withTenant(ctx, async (db): Promise<ApproveOutcome> => {
    const found = await oneRow<{ unit_id: string; reservation_id: string }>(
      db,
      'SELECT unit_id, reservation_id FROM contracts WHERE id = $1 AND company_id = $2',
      [contractId, ctx.companyId],
    );
    if (!found) throw Errors.notFound('العقد');

    await db.query('SELECT 1 FROM units WHERE id = $1 AND company_id = $2 FOR UPDATE', [found.unit_id, ctx.companyId]);
    await sweepExpiredReservations(db);
    const reservation = await oneRow<{ status: string; expires_live: boolean }>(
      db,
      `SELECT status, (expires_at > now()) AS expires_live FROM reservations
       WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [found.reservation_id, ctx.companyId],
    );
    const contract = await oneRow<LockedContract>(
      db,
      `SELECT id, status, reservation_id, unit_id, unit_price_cents::text, final_price_cents::text,
              down_payment_cents::text, installments_count, start_date
       FROM contracts WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [contractId, ctx.companyId],
    );
    if (!contract || !reservation) throw Errors.notFound('العقد');

    // الحجز انتهى (والمسودة أُلغيت تلقائياً بسبب ذلك)
    if (reservation.status === 'expired') return { kind: 'reservation_inactive' };
    if (contract.status !== 'draft') throw Errors.contractNotDraft();
    if (reservation.status !== 'active' || !reservation.expires_live) return { kind: 'reservation_inactive' };

    const unit = await oneRow<{ status: string; price_cents: string }>(
      db,
      'SELECT status, price_cents::text FROM units WHERE id = $1 AND company_id = $2',
      [contract.unit_id, ctx.companyId],
    );
    if (!unit || unit.status !== 'reserved' || unit.price_cents !== contract.unit_price_cents) {
      throw Errors.conflict('حالة الوحدة لا تسمح باعتماد العقد.');
    }

    const finalPriceCents = toInt(contract.final_price_cents);
    const schedule = generateSchedule({
      finalPriceCents,
      downPaymentCents: toInt(contract.down_payment_cents),
      installmentsCount: contract.installments_count,
      startDate: contract.start_date,
    });

    await db.query(
      `UPDATE units SET status = 'sold' WHERE id = $1 AND company_id = $2 AND status = 'reserved'`,
      [contract.unit_id, ctx.companyId],
    );
    await db.query(
      `UPDATE reservations SET status = 'converted' WHERE id = $1 AND company_id = $2 AND status = 'active'`,
      [contract.reservation_id, ctx.companyId],
    );
    await db.query(
      `UPDATE contracts SET status = 'approved', approved_by = $3, approved_at = now()
       WHERE id = $1 AND company_id = $2 AND status = 'draft'`,
      [contractId, ctx.companyId, ctx.userId],
    );
    await db.query(
      `INSERT INTO installments (company_id, contract_id, sequence, kind, due_date, amount_cents)
       SELECT $1, $2, s.sequence, s.kind, s.due_date::date, s.amount_cents
       FROM unnest($3::int[], $4::text[], $5::text[], $6::bigint[]) AS s(sequence, kind, due_date, amount_cents)`,
      [
        ctx.companyId,
        contractId,
        schedule.map((s) => s.sequence),
        schedule.map((s) => s.kind),
        schedule.map((s) => s.dueDate),
        schedule.map((s) => s.amountCents),
      ],
    );
    await writeAudit(db, {
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'CONTRACT_APPROVED',
      entityType: 'contract',
      entityId: contractId,
      details: { finalPriceCents, installmentRows: schedule.length },
      ip,
    });
    return { kind: 'ok', contract: await loadContract(db, ctx, contractId) };
  });

  if (outcome.kind === 'reservation_inactive') throw Errors.reservationExpired();
  return outcome.contract;
}
