import { z } from 'zod';
import { allocatePayment, remainingBalance, storedStatus, type InstallmentState } from '@/domain/payments';
import { oneRow, rows, withTenant } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { writeAudit } from '../audit';
import type { AuthContext } from '../auth/context';
import { positiveCentsBody, toInt } from './common';
import { loadContract, type ContractDetailDto } from './contracts';

export const recordPaymentBody = z.strictObject({
  contractId: z.uuid(),
  amountCents: positiveCentsBody,
  /** مفتاح منع التكرار: تولّده الواجهة مرة لكل نموذج، ويُعاد إرساله كما هو عند إعادة المحاولة */
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/, 'مفتاح غير صالح.'),
});
export type RecordPaymentBody = z.infer<typeof recordPaymentBody>;

export interface RecordPaymentResult {
  paymentId: string;
  /** true إن كان الطلب إعادة لدفعة سُجّلت سابقاً (لم تُنشأ دفعة جديدة) */
  replayed: boolean;
  contract: ContractDetailDto;
}

interface InstallmentRow {
  id: string;
  sequence: number;
  due_date: string;
  amount_cents: string;
  paid_cents: string;
}

/**
 * تسجيل دفعة (المحاسب فقط) في معاملة واحدة:
 *  1) قفل العقد (FOR UPDATE): الدفعات المتزامنة على العقد نفسه تتسلسل فلا تتجاوز المتبقي.
 *  2) منع التكرار: مفتاح فريد لكل شركة. إعادة الإرسال بنفس المفتاح والمحتوى تُرجع نفس الدفعة
 *     دون إنشاء جديدة؛ ونفس المفتاح بمحتوى مختلف يُرفض (422).
 *  3) توزيع الدفعة على أقدم الأقساط (منطق نقي في domain/payments) ثم تحديث الأقساط.
 *  4) سجل التدقيق. أي فشل = تراجع كامل (لا حالة نصف منفذة).
 */
export async function recordPayment(ctx: AuthContext, body: RecordPaymentBody, ip: string): Promise<RecordPaymentResult> {
  return withTenant(ctx, async (db) => {
    const contract = await oneRow<{ status: string }>(
      db,
      'SELECT status FROM contracts WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [body.contractId, ctx.companyId],
    );
    if (!contract) throw Errors.notFound('العقد');

    const existing = await oneRow<{ id: string; contract_id: string; amount_cents: string }>(
      db,
      'SELECT id, contract_id, amount_cents::text FROM payments WHERE company_id = $1 AND idempotency_key = $2',
      [ctx.companyId, body.idempotencyKey],
    );
    if (existing) {
      if (existing.contract_id !== body.contractId || toInt(existing.amount_cents) !== body.amountCents) {
        throw Errors.idempotencyMismatch();
      }
      return { paymentId: existing.id, replayed: true, contract: await loadContract(db, ctx, body.contractId) };
    }

    if (contract.status !== 'approved') {
      throw Errors.conflict('لا تُسجَّل الدفعات إلا على عقد معتمد.');
    }

    const list = await rows<InstallmentRow>(
      db,
      `SELECT id, sequence, due_date, amount_cents::text, paid_cents::text
       FROM installments WHERE contract_id = $1 AND company_id = $2 ORDER BY due_date, sequence FOR UPDATE`,
      [body.contractId, ctx.companyId],
    );
    const states: InstallmentState[] = list.map((i) => ({
      id: i.id,
      sequence: i.sequence,
      dueDate: i.due_date,
      amountCents: toInt(i.amount_cents),
      paidCents: toInt(i.paid_cents),
    }));
    if (body.amountCents > remainingBalance(states)) throw Errors.paymentExceedsBalance();
    const allocations = allocatePayment(states, body.amountCents);

    const payment = await oneRow<{ id: string }>(
      db,
      `INSERT INTO payments (company_id, contract_id, amount_cents, idempotency_key, recorded_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [ctx.companyId, body.contractId, body.amountCents, body.idempotencyKey, ctx.userId],
    );
    if (!payment) throw Errors.internal();

    for (const a of allocations) {
      await db.query(
        `INSERT INTO payment_allocations (company_id, contract_id, payment_id, installment_id, amount_cents)
         VALUES ($1, $2, $3, $4, $5)`,
        [ctx.companyId, body.contractId, payment.id, a.installmentId, a.amountCents],
      );
      await db.query(
        `UPDATE installments SET paid_cents = $3, status = $4 WHERE id = $1 AND company_id = $2`,
        [a.installmentId, ctx.companyId, a.newPaidCents, storedStatus({ amountCents: states.find((s) => s.id === a.installmentId)?.amountCents ?? 0, paidCents: a.newPaidCents })],
      );
    }

    await writeAudit(db, {
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'PAYMENT_RECORDED',
      entityType: 'payment',
      entityId: payment.id,
      details: { contractId: body.contractId, amountCents: body.amountCents, installmentsTouched: allocations.length },
      ip,
    });
    return { paymentId: payment.id, replayed: false, contract: await loadContract(db, ctx, body.contractId) };
  });
}
