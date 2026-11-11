import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, createFreshClient, createFreshUnit, loginAs, type Unit } from '../helpers/app';
import * as reservationsRoute from '@/app/api/reservations/route';
import * as contractsRoute from '@/app/api/contracts/route';
import * as approveRoute from '@/app/api/contracts/[id]/approve/route';
import * as paymentsRoute from '@/app/api/payments/route';
import * as contractRoute from '@/app/api/contracts/[id]/route';
import * as unitsRoute from '@/app/api/units/route';
import { closePool, getPool, withTenant } from '@/lib/db';
import { COMPANY } from '../helpers/app';

const today = (): string => new Date().toISOString().slice(0, 10);

describe('Concurrency (طلبات متزامنة حقيقية على PostgreSQL)', () => {
  let admin: string, rep1: string, rep2: string, accountant: string;
  beforeAll(async () => {
    [admin, rep1, rep2, accountant] = await Promise.all([
      loginAs('ofuq-admin'), loginAs('ofuq-rep1'), loginAs('ofuq-rep2'), loginAs('ofuq-accountant'),
    ]);
  });
  afterAll(async () => { await closePool(); });

  it('مندوبان يحجزان الوحدة نفسها في اللحظة نفسها: واحد ينجح والآخر يحصل على رسالة واضحة', async () => {
    const unit = await createFreshUnit(admin);
    const c1 = await createFreshClient(rep1);
    const c2 = await createFreshClient(rep2);
    const [a, b] = await Promise.all([
      call<{ error?: { code: string; message: string } }>(reservationsRoute.POST, { method: 'POST', cookie: rep1, body: { unitId: unit.id, clientId: c1.id } }),
      call<{ error?: { code: string; message: string } }>(reservationsRoute.POST, { method: 'POST', cookie: rep2, body: { unitId: unit.id, clientId: c2.id } }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.json.error?.code).toBe('UNIT_NOT_AVAILABLE');
    expect(loser.json.error?.message).toContain('لم تعد متاحة');
    const n = await withTenant({ companyId: COMPANY.ofuq }, async (db) =>
      (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM reservations WHERE unit_id=$1 AND status='active'`, [unit.id])).rows[0]?.n);
    expect(n).toBe(1);
  });

  it('30 طلب حجز متزامن على وحدة واحدة (من مندوبين): ينجح واحد فقط', async () => {
    const unit = await createFreshUnit(admin);
    const clients = await Promise.all(Array.from({ length: 6 }, (_, i) => createFreshClient(i % 2 ? rep1 : rep2, `عميل ${i}`)));
    const cookies = clients.map((_, i) => (i % 2 ? rep1 : rep2));
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        call(reservationsRoute.POST, { method: 'POST', cookie: cookies[i % 6], body: { unitId: unit.id, clientId: clients[i % 6]?.id } })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(29);
    // لا أخطاء 500 إطلاقاً (لا deadlocks ولا أخطاء غير معالجة)
    expect(results.some((r) => r.status >= 500)).toBe(false);
  });

  it('حجوزات متزامنة على وحدات مختلفة كلها تنجح (لا اختناق ولا deadlock)', async () => {
    const units = await Promise.all(Array.from({ length: 10 }, () => createFreshUnit(admin)));
    const client = await createFreshClient(rep1);
    const results = await Promise.all(units.map((u) => call(reservationsRoute.POST, { method: 'POST', cookie: rep1, body: { unitId: u.id, clientId: client.id } })));
    expect(results.every((r) => r.status === 201)).toBe(true);
  });

  async function approvedContract(finalPriceCents = 50_000_00): Promise<string> {
    const unit = await createFreshUnit(admin, 50_000_00);
    const client = await createFreshClient(rep1);
    const r = await call<{ id: string }>(reservationsRoute.POST, { method: 'POST', cookie: rep1, body: { unitId: unit.id, clientId: client.id } });
    const c = await call<{ id: string }>(contractsRoute.POST, {
      method: 'POST', cookie: rep1,
      body: { reservationId: r.json.id, finalPriceCents, downPaymentCents: 5_000_00, installmentsCount: 4, startDate: today() },
    });
    expect(c.status, JSON.stringify(c.json)).toBe(201);
    const a = await call(approveRoute.POST, { method: 'POST', cookie: accountant, params: { id: c.json.id } });
    expect(a.status, JSON.stringify(a.json)).toBe(200);
    return c.json.id;
  }

  it('اعتماد العقد نفسه من طلبين متزامنين: ينجح واحد وتُولَّد الأقساط مرة واحدة', async () => {
    const unit = await createFreshUnit(admin, 50_000_00);
    const client = await createFreshClient(rep1);
    const r = await call<{ id: string }>(reservationsRoute.POST, { method: 'POST', cookie: rep1, body: { unitId: unit.id, clientId: client.id } });
    const c = await call<{ id: string }>(contractsRoute.POST, {
      method: 'POST', cookie: rep1,
      body: { reservationId: r.json.id, finalPriceCents: 50_000_00, downPaymentCents: 0, installmentsCount: 5, startDate: today() },
    });
    const results = await Promise.all(Array.from({ length: 8 }, () => call(approveRoute.POST, { method: 'POST', cookie: accountant, params: { id: c.json.id } })));
    expect(results.filter((x) => x.status === 200)).toHaveLength(1);
    expect(results.filter((x) => x.status === 409)).toHaveLength(7);
    const n = await withTenant({ companyId: COMPANY.ofuq }, async (db) =>
      (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM installments WHERE contract_id=$1', [c.json.id])).rows[0]?.n);
    expect(n).toBe(5);
  });

  it('دفعات متزامنة لا تتجاوز مجموعها المتبقي أبداً', async () => {
    const contractId = await approvedContract();
    // المتبقي 50,000.00؛ نرسل 10 دفعات × 12,000.00 بمفاتيح مختلفة = 120,000 محاولة → 4 فقط تنجح (48,000)
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        call(paymentsRoute.POST, { method: 'POST', cookie: accountant, body: { contractId, amountCents: 12_000_00, idempotencyKey: `conc-${Date.now()}-${i}-abcdefgh` } })),
    );
    const okCount = results.filter((x) => x.status === 201).length;
    expect(okCount).toBe(4);
    expect(results.filter((x) => x.status === 422)).toHaveLength(6);
    const detail = await call<{ paidCents: number; remainingCents: number }>(contractRoute.GET, { cookie: accountant, params: { id: contractId } });
    expect(detail.json.paidCents).toBe(48_000_00);
    expect(detail.json.remainingCents).toBe(2_000_00);
  });

  it('نفس مفتاح منع التكرار بـ 10 طلبات متزامنة = دفعة واحدة فقط', async () => {
    const contractId = await approvedContract();
    const key = `idem-${Date.now()}-xxxxxxxx`;
    const results = await Promise.all(
      Array.from({ length: 10 }, () => call<{ paymentId: string; replayed: boolean }>(paymentsRoute.POST, { method: 'POST', cookie: accountant, body: { contractId, amountCents: 1_000_00, idempotencyKey: key } })),
    );
    expect(results.every((x) => x.status === 200 || x.status === 201)).toBe(true);
    expect(new Set(results.map((x) => x.json.paymentId)).size).toBe(1);
    expect(results.filter((x) => x.status === 201)).toHaveLength(1);
    const n = await withTenant({ companyId: COMPANY.ofuq }, async (db) =>
      (await db.query<{ n: number; s: string }>('SELECT count(*)::int AS n, sum(amount_cents)::text AS s FROM payments WHERE contract_id=$1', [contractId])).rows[0]);
    expect(n?.n).toBe(1);
    expect(n?.s).toBe('100000');
  });

  it('تعديل السعر والحجز المتزامنان: إما سعر جديد قبل الحجز أو رفض، ولا يتغير سعر وحدة محجوزة', async () => {
    const { PATCH } = await import('@/app/api/units/[id]/price/route');
    const unit = await createFreshUnit(admin, 80_000_00);
    const client = await createFreshClient(rep1);
    const [price, reserve] = await Promise.all([
      call(PATCH, { method: 'PATCH', cookie: admin, params: { id: unit.id }, body: { priceCents: 90_000_00 } }),
      call(reservationsRoute.POST, { method: 'POST', cookie: rep1, body: { unitId: unit.id, clientId: client.id } }),
    ]);
    expect(reserve.status).toBe(201);
    expect([200, 409]).toContain(price.status);
    const list = await call<{ items: Unit[] }>(unitsRoute.GET, { cookie: admin, path: '/api/units?status=reserved&pageSize=100' });
    const final = list.json.items.find((u) => u.id === unit.id);
    expect(final?.status).toBe('reserved');
    expect(final?.priceCents).toBe(price.status === 200 ? 90_000_00 : 80_000_00);
    // بعد الحجز: أي تعديل لاحق مرفوض
    const late = await call(PATCH, { method: 'PATCH', cookie: admin, params: { id: unit.id }, body: { priceCents: 1_00 } });
    expect(late.status).toBe(409);
  });

  it('(قاعدة البيانات وحدها) فهرس الحجز النشط الفريد يمنع حجزين نشطين حتى بتجاوز التطبيق', async () => {
    const unit = await createFreshUnit(admin);
    const client = await createFreshClient(rep1);
    const { Client } = await import('pg');
    const adminDb = new Client({ connectionString: 'postgres://postgres@127.0.0.1:5432/aqarlite_test' });
    await adminDb.connect();
    try {
      const repId = '00000000-0000-4000-8000-000000000113';
      const ins = (): Promise<unknown> => adminDb.query(
        `INSERT INTO reservations (company_id, unit_id, client_id, rep_id, reserved_at, expires_at)
         VALUES ($1,$2,$3,$4, '2026-01-01T00:00:00Z', '2026-01-04T00:00:00Z')`,
        [COMPANY.ofuq, unit.id, client.id, repId]);
      await ins();
      await expect(ins()).rejects.toThrow(/reservations_one_active_per_unit/);
    } finally { await adminDb.end(); }
    expect(getPool).toBeDefined();
  });
});
