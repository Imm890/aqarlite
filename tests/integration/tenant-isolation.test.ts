import { beforeAll, describe, expect, it } from 'vitest';
import { call, COMPANY, createFreshClient, createFreshUnit, loginAs, type Client, type Unit } from '../helpers/app';
import * as unitsRoute from '@/app/api/units/route';
import * as unitPriceRoute from '@/app/api/units/[id]/price/route';
import * as clientsRoute from '@/app/api/clients/route';
import * as clientRoute from '@/app/api/clients/[id]/route';
import * as reservationsRoute from '@/app/api/reservations/route';
import * as contractsRoute from '@/app/api/contracts/route';
import * as contractRoute from '@/app/api/contracts/[id]/route';
import * as approveRoute from '@/app/api/contracts/[id]/approve/route';
import * as paymentsRoute from '@/app/api/payments/route';
import * as auditRoute from '@/app/api/audit-logs/route';
import { closePool, withTenant } from '@/lib/db';

/**
 * اختبار عزل الشركات: مستخدم شركة "النخبة" (المهاجم) يحاول الوصول لبيانات شركة "الأفق"
 * بكل الطرق الممكنة: معرّفات مباشرة، حقن company_id في الطلب، وفلاتر القوائم.
 * يجب ألا يرى شيئاً ولا يغيّر شيئاً، وألا يُكشف حتى وجود السجل (404 لا 403).
 */
describe('Tenant isolation', () => {
  let victimAdmin: string, victimRep: string, victimAccountant: string;
  let attackerAdmin: string, attackerRep: string, attackerAccountant: string;
  let victimUnit: Unit, victimClient: Client;
  let victimContractId: string;
  let victimReservationId: string;

  beforeAll(async () => {
    [victimAdmin, victimRep, victimAccountant, attackerAdmin, attackerRep, attackerAccountant] = await Promise.all([
      loginAs('ofuq-admin'), loginAs('ofuq-rep1'), loginAs('ofuq-accountant'),
      loginAs('nokhba-admin'), loginAs('nokhba-rep1'), loginAs('nokhba-accountant'),
    ]);
    victimUnit = await createFreshUnit(victimAdmin);
    victimClient = await createFreshClient(victimRep, 'عميل الضحية');
    const r = await call<{ id: string }>(reservationsRoute.POST, {
      method: 'POST', cookie: victimRep, body: { unitId: victimUnit.id, clientId: victimClient.id },
    });
    expect(r.status).toBe(201);
    victimReservationId = r.json.id;
    const c = await call<{ id: string }>(contractsRoute.POST, {
      method: 'POST', cookie: victimRep,
      body: { reservationId: victimReservationId, finalPriceCents: 100_000_00, downPaymentCents: 10_000_00, installmentsCount: 6, startDate: new Date().toISOString().slice(0, 10) },
    });
    expect(c.status, JSON.stringify(c.json)).toBe(201);
    victimContractId = c.json.id;
  });

  it('قائمة الوحدات لا تُظهر وحدة الشركة الأخرى مهما كانت الفلاتر', async () => {
    const res = await call<{ items: Unit[]; total: number }>(unitsRoute.GET, { cookie: attackerAdmin, path: '/api/units?pageSize=100' });
    expect(res.status).toBe(200);
    expect(res.json.items.some((u) => u.id === victimUnit.id)).toBe(false);
    expect(res.json.total).toBeGreaterThan(0); // يرى وحدات شركته هو
  });

  it('حقن companyId في استعلام القائمة يُرفض (حقل غير مسموح) ولا يغيّر النطاق', async () => {
    const res = await call(unitsRoute.GET, { cookie: attackerAdmin, path: `/api/units?companyId=${COMPANY.ofuq}` });
    expect(res.status).toBe(422);
  });

  it('تعديل سعر وحدة شركة أخرى = 404', async () => {
    const res = await call(unitPriceRoute.PATCH, {
      method: 'PATCH', cookie: attackerAdmin, params: { id: victimUnit.id }, body: { priceCents: 1_00 },
    });
    expect(res.status).toBe(404);
    const check = await withTenant({ companyId: COMPANY.ofuq }, async (db) =>
      (await db.query<{ price_cents: string }>('SELECT price_cents::text FROM units WHERE id=$1', [victimUnit.id])).rows[0]?.price_cents);
    expect(check).toBe(String(victimUnit.priceCents));
  });

  it('إنشاء وحدة مع companyId لشركة أخرى في الجسم يُرفض (mass assignment)', async () => {
    const res = await call(unitsRoute.POST, {
      method: 'POST', cookie: attackerAdmin,
      body: { project: 'x', number: `inj-${Date.now()}`, type: 'villa', areaSqm: 100, rooms: 2, priceCents: 100_00, companyId: COMPANY.ofuq },
    });
    expect(res.status).toBe(422);
  });

  it('قراءة عميل شركة أخرى بمعرّفه = 404', async () => {
    const res = await call(clientRoute.GET, { cookie: attackerAdmin, params: { id: victimClient.id } });
    expect(res.status).toBe(404);
  });

  it('قائمة العملاء لا تُظهر عملاء الشركة الأخرى حتى بالبحث بالاسم', async () => {
    const res = await call<{ items: Client[] }>(clientsRoute.GET, { cookie: attackerAdmin, path: '/api/clients?q=' + encodeURIComponent('عميل الضحية') });
    expect(res.json.items).toHaveLength(0);
  });

  it('حجز وحدة شركة أخرى (ولو بعميل من شركتي) = 404 والوحدة تبقى متاحة', async () => {
    const free = await createFreshUnit(victimAdmin);
    const myClient = await createFreshClient(attackerRep);
    const res = await call(reservationsRoute.POST, { method: 'POST', cookie: attackerRep, body: { unitId: free.id, clientId: myClient.id } });
    expect(res.status).toBe(404);
    const list = await call<{ items: Unit[] }>(unitsRoute.GET, { cookie: victimAdmin, path: '/api/units?status=available&pageSize=100' });
    expect(list.json.items.find((u) => u.id === free.id)?.status).toBe('available');
  });

  it('حجز وحدة من شركتي بعميل من شركة أخرى = 404', async () => {
    const mine = await createFreshUnit(attackerAdmin);
    const res = await call(reservationsRoute.POST, { method: 'POST', cookie: attackerRep, body: { unitId: mine.id, clientId: victimClient.id } });
    expect(res.status).toBe(404);
  });

  it('عقد شركة أخرى: قراءة واعتماد وقائمة', async () => {
    expect((await call(contractRoute.GET, { cookie: attackerAccountant, params: { id: victimContractId } })).status).toBe(404);
    expect((await call(approveRoute.POST, { method: 'POST', cookie: attackerAccountant, params: { id: victimContractId } })).status).toBe(404);
    const list = await call<{ items: { id: string }[] }>(contractsRoute.GET, { cookie: attackerAccountant, path: '/api/contracts?pageSize=100' });
    expect(list.json.items.some((c) => c.id === victimContractId)).toBe(false);
  });

  it('إنشاء عقد من حجز شركة أخرى = 404', async () => {
    const res = await call(contractsRoute.POST, {
      method: 'POST', cookie: attackerRep,
      body: { reservationId: victimReservationId, finalPriceCents: 100_000_00, downPaymentCents: 0, installmentsCount: 3, startDate: new Date().toISOString().slice(0, 10) },
    });
    expect(res.status).toBe(404);
  });

  it('تسجيل دفعة على عقد شركة أخرى = 404 (حتى بعد اعتماده)', async () => {
    const ok = await call(approveRoute.POST, { method: 'POST', cookie: victimAccountant, params: { id: victimContractId } });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    const res = await call(paymentsRoute.POST, {
      method: 'POST', cookie: attackerAccountant,
      body: { contractId: victimContractId, amountCents: 1_00, idempotencyKey: `iso-${Date.now()}-aaaa` },
    });
    expect(res.status).toBe(404);
    const detail = await call<{ paidCents: number }>(contractRoute.GET, { cookie: victimAccountant, params: { id: victimContractId } });
    expect(detail.json.paidCents).toBe(0);
  });

  it('سجل التدقيق: كل مدير يرى سجلات شركته فقط', async () => {
    const mine = await call<{ items: { details: Record<string, unknown> }[] }>(auditRoute.GET, { cookie: attackerAdmin, path: '/api/audit-logs?pageSize=100' });
    expect(mine.status).toBe(200);
    expect(JSON.stringify(mine.json.items)).not.toContain(victimUnit.id);
    expect(JSON.stringify(mine.json.items)).not.toContain(victimContractId);
    const theirs = await call<{ items: unknown[] }>(auditRoute.GET, { cookie: victimAdmin, path: '/api/audit-logs?pageSize=100' });
    expect(JSON.stringify(theirs.json.items)).toContain(victimUnit.id);
  });

  describe('دفاع قاعدة البيانات (RLS) حتى لو أخطأ كود التطبيق', () => {
    it('استعلام بلا شروط داخل سياق شركة لا يرجع إلا صفوفها', async () => {
      const rows = await withTenant({ companyId: COMPANY.nokhba }, async (db) =>
        (await db.query<{ company_id: string }>('SELECT DISTINCT company_id FROM units')).rows);
      expect(rows.map((r) => r.company_id)).toEqual([COMPANY.nokhba]);
    });

    it('قراءة صف شركة أخرى بمعرّفه المباشر لا ترجع شيئاً', async () => {
      const rows = await withTenant({ companyId: COMPANY.nokhba }, async (db) =>
        (await db.query('SELECT id FROM units WHERE id = $1', [victimUnit.id])).rows);
      expect(rows).toHaveLength(0);
    });

    it('تعديل صف شركة أخرى يمس 0 صفوف', async () => {
      const count = await withTenant({ companyId: COMPANY.nokhba }, async (db) =>
        (await db.query('UPDATE units SET price_cents = 1 WHERE id = $1', [victimUnit.id])).rowCount);
      expect(count).toBe(0);
    });

    it('إدخال صف بشركة أخرى مرفوض من السياسة', async () => {
      await expect(
        withTenant({ companyId: COMPANY.nokhba }, (db) =>
          db.query(
            `INSERT INTO clients (company_id, owner_id, name, phone) VALUES ($1, $2, 'x', '+966500000000')`,
            [COMPANY.ofuq, '00000000-0000-4000-8000-000000000113'],
          )),
      ).rejects.toThrow(/row-level security|violates/i);
    });

    it('المفتاح الأجنبي المركّب يمنع ربط سجل بسجل شركة أخرى', async () => {
      // عميل شركتي مع مندوب من شركة أخرى: مرفوض بقيد قاعدة البيانات نفسه حتى بصلاحيات الإدارة
      const { Client } = await import('pg');
      const admin = new Client({ connectionString: 'postgres://postgres@127.0.0.1:5432/aqarlite_test' });
      await admin.connect();
      try {
        await expect(
          admin.query(
            `INSERT INTO clients (company_id, owner_id, name, phone) VALUES ($1, $2, 'x', '+966500000000')`,
            [COMPANY.nokhba, '00000000-0000-4000-8000-000000000113'],
          ),
        ).rejects.toThrow(/foreign key/i);
      } finally {
        await admin.end();
      }
    });

    it('بلا ضبط الشركة لا صفوف أبداً (إغلاق آمن)', async () => {
      const { getPool } = await import('@/lib/db');
      const res = await getPool().query('SELECT count(*)::int AS n FROM units');
      expect(res.rows[0].n).toBe(0);
    });
  });

  it('إغلاق المجمع', async () => {
    await closePool();
  });
});
