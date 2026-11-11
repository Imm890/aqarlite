import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { call, COMPANY, createFreshClient, createFreshUnit, loginAs } from '../helpers/app';
import * as reservationsRoute from '@/app/api/reservations/route';
import * as contractsRoute from '@/app/api/contracts/route';
import * as contractRoute from '@/app/api/contracts/[id]/route';
import * as approveRoute from '@/app/api/contracts/[id]/approve/route';
import * as paymentsRoute from '@/app/api/payments/route';
import * as unitsRoute from '@/app/api/units/route';
import * as priceRoute from '@/app/api/units/[id]/price/route';
import * as auditRoute from '@/app/api/audit-logs/route';
import { closePool } from '@/lib/db';

const ADMIN_URL = 'postgres://postgres@127.0.0.1:5432/aqarlite_test';
const today = (): string => new Date().toISOString().slice(0, 10);
let seq = 0;
const key = (): string => `flow-${Date.now()}-${(seq += 1)}-abcdefgh`;

interface Inst { sequence: number; kind: string; dueDate: string; amountCents: number; paidCents: number; status: string; remainingCents: number }
interface Detail { id: string; status: string; finalPriceCents: number; paidCents: number; remainingCents: number; installments: Inst[]; payments: { amountCents: number }[]; error?: { code: string } }

describe('المسار الأساسي: حجز → مسودة → اعتماد → أقساط → دفعات', () => {
  let admin: string, rep1: string, rep2: string, accountant: string;
  beforeAll(async () => {
    [admin, rep1, rep2, accountant] = await Promise.all([loginAs('ofuq-admin'), loginAs('ofuq-rep1'), loginAs('ofuq-rep2'), loginAs('ofuq-accountant')]);
  });
  afterAll(async () => { await closePool(); });

  async function reserve(price = 100_000_00, cookie = rep1): Promise<{ unitId: string; reservationId: string }> {
    const unit = await createFreshUnit(admin, price);
    const client = await createFreshClient(cookie);
    const r = await call<{ id: string }>(reservationsRoute.POST, { method: 'POST', cookie, body: { unitId: unit.id, clientId: client.id } });
    expect(r.status).toBe(201);
    return { unitId: unit.id, reservationId: r.json.id };
  }
  const draft = (reservationId: string, over: Record<string, unknown> = {}, cookie = rep1) =>
    call<Detail>(contractsRoute.POST, {
      method: 'POST', cookie,
      body: { reservationId, finalPriceCents: 100_000_00, downPaymentCents: 10_000_00, installmentsCount: 9, startDate: today(), ...over },
    });
  const unitStatus = async (id: string): Promise<string | undefined> =>
    (await call<{ items: { id: string; status: string }[] }>(unitsRoute.GET, { cookie: admin, path: '/api/units?pageSize=100&sort=area&order=desc' })).json.items.find((u) => u.id === id)?.status;

  it('المسار الكامل بدقة الهللة', async () => {
    const { unitId, reservationId } = await reserve();
    expect(await unitStatus(unitId)).toBe('reserved');

    const d = await draft(reservationId, { finalPriceCents: 99_999_99, downPaymentCents: 12_345_67, installmentsCount: 7 });
    expect(d.status, JSON.stringify(d.json)).toBe(201);
    expect(d.json.status).toBe('draft');
    expect(d.json.installments).toHaveLength(8); // دفعة أولى + 7 أقساط (معاينة)

    const a = await call<Detail>(approveRoute.POST, { method: 'POST', cookie: accountant, params: { id: d.json.id } });
    expect(a.status, JSON.stringify(a.json)).toBe(200);
    expect(a.json.status).toBe('approved');
    expect(await unitStatus(unitId)).toBe('sold');
    const total = a.json.installments.reduce((t, i) => t + i.amountCents, 0);
    expect(total).toBe(99_999_99); // مجموع الأقساط + الدفعة الأولى = السعر النهائي بدقة

    // دفعة 15,000.00 توزَّع على أقدم الأقساط: الدفعة الأولى 12,345.67 ثم جزء من القسط 1
    const p1 = await call<{ contract: Detail }>(paymentsRoute.POST, { method: 'POST', cookie: accountant, body: { contractId: d.json.id, amountCents: 15_000_00, idempotencyKey: key() } });
    expect(p1.status, JSON.stringify(p1.json)).toBe(201);
    const [first, second, third] = p1.json.contract.installments;
    expect(first).toMatchObject({ kind: 'down_payment', status: 'paid', paidCents: 12_345_67 });
    expect(second?.status).toBe('partial');
    expect(second?.paidCents).toBe(15_000_00 - 12_345_67);
    expect(third?.status).toBe('pending');
    expect(p1.json.contract.remainingCents).toBe(99_999_99 - 15_000_00);

    // تسديد كامل المتبقي
    const rest = p1.json.contract.remainingCents;
    const p2 = await call<{ contract: Detail }>(paymentsRoute.POST, { method: 'POST', cookie: accountant, body: { contractId: d.json.id, amountCents: rest, idempotencyKey: key() } });
    expect(p2.status).toBe(201);
    expect(p2.json.contract.remainingCents).toBe(0);
    expect(p2.json.contract.installments.every((i) => i.status === 'paid')).toBe(true);

    // لا دفعة بعد السداد الكامل
    const over = await call<Detail>(paymentsRoute.POST, { method: 'POST', cookie: accountant, body: { contractId: d.json.id, amountCents: 1, idempotencyKey: key() } });
    expect(over.status).toBe(422);
    expect(over.json.error?.code).toBe('PAYMENT_EXCEEDS_BALANCE');
  });

  it('الخصم: 5% بالضبط مقبول وأكثر منه بهللة مرفوض، وأعلى من السعر مرفوض', async () => {
    const a = await reserve(100_000_00);
    expect((await draft(a.reservationId, { finalPriceCents: 94_999_99 })).json.error?.code).toBe('DISCOUNT_TOO_HIGH');
    expect((await draft(a.reservationId, { finalPriceCents: 100_000_01 })).json.error?.code).toBe('DISCOUNT_TOO_HIGH');
    expect((await draft(a.reservationId, { finalPriceCents: 95_000_00 })).status).toBe(201);
  });

  it('المسودة: خطأ التحقق يظهر لكل حقل', async () => {
    const { reservationId } = await reserve();
    const res = await draft(reservationId, { installmentsCount: 0, startDate: '2026-02-30', downPaymentCents: 1.5 });
    expect(res.status).toBe(422);
    const fields = (res.json as unknown as { error: { fields: Record<string, string> } }).error.fields;
    expect(Object.keys(fields).sort()).toEqual(['downPaymentCents', 'installmentsCount', 'startDate']);
  });

  it('الدفعة الأولى ≥ السعر النهائي مرفوضة', async () => {
    const { reservationId } = await reserve();
    const res = await draft(reservationId, { downPaymentCents: 100_000_00 });
    expect(res.status).toBe(422);
  });

  it('لا عقد من حجز مندوب آخر، ولا عقدين حيّين لحجز واحد', async () => {
    const { reservationId } = await reserve();
    expect((await draft(reservationId, {}, rep2)).status).toBe(404);
    expect((await draft(reservationId)).status).toBe(201);
    const again = await draft(reservationId);
    expect(again.status).toBe(409);
  });

  it('بعد الاعتماد: لا اعتماد ثانٍ، ولا تعديل مباشر في قاعدة البيانات (حتى للمسؤول)', async () => {
    const { reservationId } = await reserve();
    const d = await draft(reservationId);
    await call(approveRoute.POST, { method: 'POST', cookie: accountant, params: { id: d.json.id } });
    const second = await call<Detail>(approveRoute.POST, { method: 'POST', cookie: accountant, params: { id: d.json.id } });
    expect(second.status).toBe(409);
    expect(second.json.error?.code).toBe('CONTRACT_NOT_DRAFT');

    const db = new pg.Client({ connectionString: ADMIN_URL });
    await db.connect();
    try {
      await expect(db.query('UPDATE contracts SET final_price_cents = 1 WHERE id = $1', [d.json.id])).rejects.toThrow(/AQ_CONTRACT_IMMUTABLE|check/i);
      await expect(db.query('UPDATE installments SET amount_cents = 1 WHERE contract_id = $1', [d.json.id])).rejects.toThrow(/AQ_INSTALLMENT_IMMUTABLE/);
    } finally { await db.end(); }
  });

  it('الدفعة المسجّلة لا تُعدَّل ولا تُحذف، وسجل التدقيق كذلك (قاعدة البيانات)', async () => {
    const { reservationId } = await reserve();
    const d = await draft(reservationId);
    await call(approveRoute.POST, { method: 'POST', cookie: accountant, params: { id: d.json.id } });
    await call(paymentsRoute.POST, { method: 'POST', cookie: accountant, body: { contractId: d.json.id, amountCents: 5_00, idempotencyKey: key() } });
    const db = new pg.Client({ connectionString: ADMIN_URL });
    await db.connect();
    try {
      await expect(db.query('UPDATE payments SET amount_cents = 1 WHERE contract_id = $1', [d.json.id])).rejects.toThrow(/AQ_IMMUTABLE_RECORD/);
      await expect(db.query('DELETE FROM payments WHERE contract_id = $1', [d.json.id])).rejects.toThrow(/AQ_IMMUTABLE_RECORD/);
      await expect(db.query('UPDATE audit_logs SET action = $1', ['X'])).rejects.toThrow(/AQ_IMMUTABLE_RECORD/);
      await expect(db.query('DELETE FROM audit_logs')).rejects.toThrow(/AQ_IMMUTABLE_RECORD/);
      await expect(db.query('TRUNCATE payments CASCADE')).rejects.toThrow(/AQ_IMMUTABLE_RECORD/);
    } finally { await db.end(); }
  });

  it('منع التكرار: إعادة الإرسال بنفس المفتاح = نفس الدفعة، وبمبلغ مختلف = 422', async () => {
    const { reservationId } = await reserve();
    const d = await draft(reservationId);
    await call(approveRoute.POST, { method: 'POST', cookie: accountant, params: { id: d.json.id } });
    const k = key();
    const first = await call<{ paymentId: string; replayed: boolean }>(paymentsRoute.POST, { method: 'POST', cookie: accountant, body: { contractId: d.json.id, amountCents: 7_00, idempotencyKey: k } });
    const replay = await call<{ paymentId: string; replayed: boolean }>(paymentsRoute.POST, { method: 'POST', cookie: accountant, body: { contractId: d.json.id, amountCents: 7_00, idempotencyKey: k } });
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.json.replayed).toBe(true);
    expect(replay.json.paymentId).toBe(first.json.paymentId);
    const mismatch = await call<Detail>(paymentsRoute.POST, { method: 'POST', cookie: accountant, body: { contractId: d.json.id, amountCents: 8_00, idempotencyKey: k } });
    expect(mismatch.status).toBe(422);
    expect(mismatch.json.error?.code).toBe('IDEMPOTENCY_MISMATCH');
    const detail = await call<Detail>(contractRoute.GET, { cookie: accountant, params: { id: d.json.id } });
    expect(detail.json.payments).toHaveLength(1);
    expect(detail.json.paidCents).toBe(7_00);
  });

  it('دفعة على مسودة غير معتمدة مرفوضة', async () => {
    const { reservationId } = await reserve();
    const d = await draft(reservationId);
    const res = await call(paymentsRoute.POST, { method: 'POST', cookie: accountant, body: { contractId: d.json.id, amountCents: 1_00, idempotencyKey: key() } });
    expect(res.status).toBe(409);
  });

  it('مبالغ غير صحيحة مرفوضة: كسر، سالب، صفر، نص، ضخم', async () => {
    const { reservationId } = await reserve();
    const d = await draft(reservationId);
    await call(approveRoute.POST, { method: 'POST', cookie: accountant, params: { id: d.json.id } });
    for (const amountCents of [12.5, -5, 0, '100', 1e15, Number.MAX_SAFE_INTEGER]) {
      const res = await call(paymentsRoute.POST, { method: 'POST', cookie: accountant, body: { contractId: d.json.id, amountCents, idempotencyKey: key() } });
      expect(res.status, `amount=${String(amountCents)}`).toBe(422);
    }
  });

  it('قفل السعر: لا تعديل لوحدة محجوزة أو مُباعة، والتعديل المسموح يُسجَّل في التدقيق', async () => {
    const free = await createFreshUnit(admin, 70_000_00);
    const ok = await call<{ priceCents: number }>(priceRoute.PATCH, { method: 'PATCH', cookie: admin, params: { id: free.id }, body: { priceCents: 72_500_00 } });
    expect(ok.status).toBe(200);
    expect(ok.json.priceCents).toBe(72_500_00);

    const { unitId, reservationId } = await reserve();
    const reserved = await call<{ error: { code: string } }>(priceRoute.PATCH, { method: 'PATCH', cookie: admin, params: { id: unitId }, body: { priceCents: 1_00 } });
    expect(reserved.status).toBe(409);
    expect(reserved.json.error.code).toBe('UNIT_LOCKED_FOR_PRICE');
    const d = await draft(reservationId);
    await call(approveRoute.POST, { method: 'POST', cookie: accountant, params: { id: d.json.id } });
    expect((await call(priceRoute.PATCH, { method: 'PATCH', cookie: admin, params: { id: unitId }, body: { priceCents: 1_00 } })).status).toBe(409);

    const audit = await call<{ items: { action: string; entityId: string; details: Record<string, unknown> }[] }>(auditRoute.GET, { cookie: admin, path: '/api/audit-logs?action=UNIT_PRICE_CHANGED&pageSize=100' });
    const entry = audit.json.items.find((e) => e.entityId === free.id);
    expect(entry?.details).toMatchObject({ oldPriceCents: 70_000_00, newPriceCents: 72_500_00 });
  });

  it('التدقيق يغطي: الاعتماد والدفعة وفشل الدخول، ولا يحوي كلمات مرور', async () => {
    const { reservationId } = await reserve();
    const d = await draft(reservationId);
    await call(approveRoute.POST, { method: 'POST', cookie: accountant, params: { id: d.json.id } });
    await call(paymentsRoute.POST, { method: 'POST', cookie: accountant, body: { contractId: d.json.id, amountCents: 3_00, idempotencyKey: key() } });
    const { POST: login } = await import('@/app/api/auth/login/route');
    await call(login, { method: 'POST', body: { email: 'admin@ofuq.example', password: 'SuperSecret-wrong-1' } });

    const all = await call<{ items: { action: string; details: Record<string, unknown> }[] }>(auditRoute.GET, { cookie: admin, path: '/api/audit-logs?pageSize=100' });
    const actions = new Set(all.json.items.map((e) => e.action));
    for (const a of ['CONTRACT_APPROVED', 'PAYMENT_RECORDED', 'LOGIN_FAILED', 'UNIT_CREATED', 'RESERVATION_CREATED', 'CONTRACT_CREATED']) expect(actions.has(a), a).toBe(true);
    expect(JSON.stringify(all.json)).not.toContain('SuperSecret-wrong-1');
  });

  it('انتهاء الحجز بعد 72 ساعة: تعود الوحدة متاحة دون تدخل ويمكن لمندوب آخر حجزها، ولا يُعتمد عقد منتهٍ', async () => {
    const { unitId, reservationId } = await reserve();
    const d = await draft(reservationId);

    const db = new pg.Client({ connectionString: ADMIN_URL });
    await db.connect();
    try {
      await db.query('BEGIN');
      await db.query("SET LOCAL session_replication_role = replica"); // يتجاوز المحفّزات (محاكاة مرور الزمن)
      await db.query("UPDATE reservations SET reserved_at = now() - interval '73 hours', expires_at = now() - interval '1 hour' WHERE id = $1", [reservationId]);
      await db.query('COMMIT');
    } finally { await db.end(); }

    // تظهر الوحدة متاحة فور القراءة، دون أي إجراء يدوي
    expect(await unitStatus(unitId)).toBe('available');
    const detail = await call<Detail>(contractRoute.GET, { cookie: rep1, params: { id: d.json.id } });
    expect(detail.json.status).toBe('cancelled');
    const approve = await call<Detail>(approveRoute.POST, { method: 'POST', cookie: accountant, params: { id: d.json.id } });
    expect([404, 409]).toContain(approve.status);

    const c2 = await createFreshClient(rep2);
    const r2 = await call(reservationsRoute.POST, { method: 'POST', cookie: rep2, body: { unitId, clientId: c2.id } });
    expect(r2.status).toBe(201);
    expect(COMPANY.ofuq).toBeTruthy();
  });
});
