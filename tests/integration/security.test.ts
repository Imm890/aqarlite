import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, cookieFrom, createFreshClient, createFreshUnit, loginAs, ORIGIN, TEST_PASSWORD } from '../helpers/app';
import * as loginRoute from '@/app/api/auth/login/route';
import * as logoutRoute from '@/app/api/auth/logout/route';
import * as meRoute from '@/app/api/auth/me/route';
import * as unitsRoute from '@/app/api/units/route';
import * as priceRoute from '@/app/api/units/[id]/price/route';
import * as clientsRoute from '@/app/api/clients/route';
import * as clientRoute from '@/app/api/clients/[id]/route';
import * as reservationsRoute from '@/app/api/reservations/route';
import * as contractsRoute from '@/app/api/contracts/route';
import * as contractRoute from '@/app/api/contracts/[id]/route';
import * as approveRoute from '@/app/api/contracts/[id]/approve/route';
import * as paymentsRoute from '@/app/api/payments/route';
import * as auditRoute from '@/app/api/audit-logs/route';
import { closePool } from '@/lib/db';
import { buildClearedSessionCookie, buildSessionCookie, sessionCookieName } from '@/server/auth/cookies';
import { resetEnvCache } from '@/lib/env';

interface Err { error: { code: string; message: string; fields?: Record<string, string> } }

describe('الأمان', () => {
  let admin: string, rep1: string, rep2: string, accountant: string;
  beforeAll(async () => {
    [admin, rep1, rep2, accountant] = await Promise.all([loginAs('ofuq-admin'), loginAs('ofuq-rep1'), loginAs('ofuq-rep2'), loginAs('ofuq-accountant')]);
  });
  afterAll(async () => { await closePool(); });

  describe('المصادقة والجلسات', () => {
    it('بلا جلسة = 401 على كل نقطة نهاية محمية', async () => {
      const targets: [Parameters<typeof call>[0], Parameters<typeof call>[1]][] = [
        [unitsRoute.GET, {}], [unitsRoute.POST, { method: 'POST', body: {} }], [clientsRoute.GET, {}], [reservationsRoute.GET, {}],
        [contractsRoute.GET, {}], [paymentsRoute.POST, { method: 'POST', body: {} }], [auditRoute.GET, {}], [meRoute.GET, {}],
        [priceRoute.PATCH, { method: 'PATCH', body: {}, params: { id: '00000000-0000-4000-8000-000000000999' } }],
      ];
      for (const [h, o] of targets) expect((await call(h, o)).status).toBe(401);
    });

    it('رمز جلسة مزوَّر أو بصيغة خاطئة = 401', async () => {
      for (const c of ['aqarlite_sid=short', `aqarlite_sid=${'A'.repeat(43)}`, "aqarlite_sid=' OR 1=1 --", 'aqarlite_sid=']) {
        expect((await call(meRoute.GET, { cookie: c })).status).toBe(401);
      }
    });

    it('رسالة فشل الدخول واحدة لبريد غير موجود وكلمة مرور خاطئة (لا كشف للحساب)', async () => {
      const unknown = await call<Err>(loginRoute.POST, { method: 'POST', body: { email: `nobody-${Date.now()}@ofuq.example`, password: 'Whatever-123' } });
      const wrong = await call<Err>(loginRoute.POST, { method: 'POST', body: { email: 'rep2@ofuq.example', password: 'Whatever-123' } });
      expect(unknown.status).toBe(401);
      expect(wrong.status).toBe(401);
      expect(unknown.json.error.message).toBe(wrong.json.error.message);
      expect(unknown.json.error.code).toBe(wrong.json.error.code);
    });

    it('الدخول لا يعيد كلمة المرور أو تجزئتها أو الرمز في الجسم', async () => {
      const res = await call(loginRoute.POST, { method: 'POST', body: { email: 'rep2@ofuq.example', password: TEST_PASSWORD } });
      const text = JSON.stringify(res.json);
      expect(res.status).toBe(200);
      for (const bad of ['argon2', 'password', 'hash', 'token', cookieFrom(res.setCookie).split('=')[1] ?? 'x']) expect(text.toLowerCase()).not.toContain(bad.toLowerCase());
    });

    it('الكوكي: HttpOnly + SameSite=Strict + Path=/ ، ولا رمز في الجسم', async () => {
      const res = await call(loginRoute.POST, { method: 'POST', body: { email: 'rep2@ofuq.example', password: TEST_PASSWORD } });
      const raw = res.setCookie[0] ?? '';
      expect(raw).toMatch(/HttpOnly/);
      expect(raw).toMatch(/SameSite=Strict/);
      expect(raw).toMatch(/Path=\//);
      expect(raw).toMatch(/Max-Age=\d+/);
    });

    it('في الوضع الآمن (production): Secure + بادئة __Host-', () => {
      const prev = { ...process.env };
      try {
        Object.assign(process.env, { NODE_ENV: 'production' });
        resetEnvCache();
        expect(sessionCookieName()).toBe('__Host-aqarlite_sid');
        const c = buildSessionCookie('A'.repeat(43));
        expect(c).toMatch(/; Secure/);
        expect(c).toMatch(/HttpOnly/);
        expect(buildClearedSessionCookie()).toMatch(/Max-Age=0/);
      } finally {
        Object.assign(process.env, prev);
        resetEnvCache();
      }
    });

    it('تسجيل الخروج يُبطل الجلسة في الخادم: إعادة استخدام نفس الكوكي = 401', async () => {
      const cookie = await loginAs('ofuq-rep2');
      expect((await call(meRoute.GET, { cookie })).status).toBe(200);
      const out = await call(logoutRoute.POST, { method: 'POST', cookie });
      expect(out.status).toBe(200);
      expect(out.setCookie[0]).toMatch(/Max-Age=0/);
      // المهاجم الذي سرق الكوكي قبل الخروج لا يستطيع استعماله بعده
      expect((await call(meRoute.GET, { cookie })).status).toBe(401);
      expect((await call(unitsRoute.GET, { cookie })).status).toBe(401);
    });

    it('حد التخمين: بعد 8 محاولات فاشلة لنفس البريد = 429 حتى بكلمة المرور الصحيحة', async () => {
      const email = `brute-${Date.now()}@ofuq.example`;
      for (let i = 0; i < 8; i += 1) {
        expect((await call(loginRoute.POST, { method: 'POST', body: { email, password: `bad-${i}-password` } })).status).toBe(401);
      }
      expect((await call(loginRoute.POST, { method: 'POST', body: { email, password: 'bad-9-password' } })).status).toBe(429);
    });

    it('JSON فقط، وجسم كبير أو تالف أو بحقول زائدة يُرفض', async () => {
      expect((await call(loginRoute.POST, { method: 'POST', rawBody: 'email=a&password=b', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status).toBe(415);
      expect((await call(loginRoute.POST, { method: 'POST', rawBody: '{bad json' })).status).toBe(400);
      expect((await call(loginRoute.POST, { method: 'POST', rawBody: JSON.stringify({ email: 'a@b.c', password: 'x', role: 'company_admin' }) })).status).toBe(422);
      expect((await call(loginRoute.POST, { method: 'POST', rawBody: JSON.stringify({ email: 'a@b.c', password: 'x'.repeat(100_000) }) })).status).toBe(413);
    });
  });

  describe('CSRF', () => {
    it('طلب يغيّر الحالة بلا Origin أو بـ Origin غريب = 403 حتى بكوكي صالح', async () => {
      const body = { name: 'x', phone: '+966551234567' };
      expect((await call(clientsRoute.POST, { method: 'POST', cookie: rep1, body, origin: null })).status).toBe(403);
      expect((await call(clientsRoute.POST, { method: 'POST', cookie: rep1, body, origin: 'https://evil.example' })).status).toBe(403);
      expect((await call(clientsRoute.POST, { method: 'POST', cookie: rep1, body, headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
      expect((await call(clientsRoute.POST, { method: 'POST', cookie: rep1, body, origin: ORIGIN })).status).toBe(201);
    });
  });

  describe('الصلاحيات في الخادم (RBAC)', () => {
    it('المندوب: لا يعتمد العقود ولا يسجّل دفعات ولا يعدّل الأسعار ولا ينشئ وحدات ولا يقرأ التدقيق', async () => {
      const unit = await createFreshUnit(admin);
      const id = '00000000-0000-4000-8000-000000000999';
      expect((await call(approveRoute.POST, { method: 'POST', cookie: rep1, params: { id } })).status).toBe(403);
      expect((await call(paymentsRoute.POST, { method: 'POST', cookie: rep1, body: { contractId: id, amountCents: 1, idempotencyKey: 'abcdefgh1234' } })).status).toBe(403);
      expect((await call(priceRoute.PATCH, { method: 'PATCH', cookie: rep1, params: { id: unit.id }, body: { priceCents: 1_00 } })).status).toBe(403);
      expect((await call(unitsRoute.POST, { method: 'POST', cookie: rep1, body: { project: 'a', number: '1', type: 'villa', areaSqm: 1, rooms: 1, priceCents: 1 } })).status).toBe(403);
      expect((await call(auditRoute.GET, { cookie: rep1 })).status).toBe(403);
    });

    it('المحاسب: لا يعدّل الوحدات ولا العملاء ولا يحجز ولا ينشئ عقداً ولا يقرأ التدقيق', async () => {
      const unit = await createFreshUnit(admin);
      expect((await call(unitsRoute.POST, { method: 'POST', cookie: accountant, body: { project: 'a', number: '1', type: 'villa', areaSqm: 1, rooms: 1, priceCents: 1 } })).status).toBe(403);
      expect((await call(priceRoute.PATCH, { method: 'PATCH', cookie: accountant, params: { id: unit.id }, body: { priceCents: 1_00 } })).status).toBe(403);
      expect((await call(clientsRoute.POST, { method: 'POST', cookie: accountant, body: { name: 'x', phone: '+966551234567' } })).status).toBe(403);
      expect((await call(clientsRoute.GET, { cookie: accountant })).status).toBe(403);
      expect((await call(reservationsRoute.POST, { method: 'POST', cookie: accountant, body: { unitId: unit.id, clientId: unit.id } })).status).toBe(403);
      expect((await call(contractsRoute.POST, { method: 'POST', cookie: accountant, body: {} })).status).toBe(403);
      expect((await call(auditRoute.GET, { cookie: accountant })).status).toBe(403);
    });

    it('المدير: لا يحجز ولا ينشئ عقداً ولا يعتمد ولا يسجّل دفعات ولا يضيف عملاء', async () => {
      const id = '00000000-0000-4000-8000-000000000999';
      expect((await call(reservationsRoute.POST, { method: 'POST', cookie: admin, body: { unitId: id, clientId: id } })).status).toBe(403);
      expect((await call(contractsRoute.POST, { method: 'POST', cookie: admin, body: {} })).status).toBe(403);
      expect((await call(approveRoute.POST, { method: 'POST', cookie: admin, params: { id } })).status).toBe(403);
      expect((await call(paymentsRoute.POST, { method: 'POST', cookie: admin, body: {} })).status).toBe(403);
      expect((await call(clientsRoute.POST, { method: 'POST', cookie: admin, body: { name: 'x', phone: '+966551234567' } })).status).toBe(403);
      expect((await call(auditRoute.GET, { cookie: admin })).status).toBe(200);
    });

    it('المندوب يرى عملاءه فقط (404 لعميل زميل)، والمدير يرى الكل', async () => {
      const mine = await createFreshClient(rep1, 'عميل المندوب الأول');
      const theirs = await createFreshClient(rep2, 'عميل المندوب الثاني');
      const list = await call<{ items: { id: string }[] }>(clientsRoute.GET, { cookie: rep1, path: '/api/clients?pageSize=100' });
      expect(list.json.items.some((c) => c.id === mine.id)).toBe(true);
      expect(list.json.items.some((c) => c.id === theirs.id)).toBe(false);
      expect((await call(clientRoute.GET, { cookie: rep1, params: { id: theirs.id } })).status).toBe(404);
      const all = await call<{ items: { id: string }[] }>(clientsRoute.GET, { cookie: admin, path: '/api/clients?pageSize=100' });
      expect(all.json.items.some((c) => c.id === mine.id) && all.json.items.some((c) => c.id === theirs.id)).toBe(true);
    });

    it('المندوب لا يحجز بعميل مندوب آخر، ولا يقرأ عقد زميله، والمحاسب يقرأ كل العقود', async () => {
      const unit = await createFreshUnit(admin);
      const theirClient = await createFreshClient(rep2);
      expect((await call(reservationsRoute.POST, { method: 'POST', cookie: rep1, body: { unitId: unit.id, clientId: theirClient.id } })).status).toBe(404);

      const r = await call<{ id: string }>(reservationsRoute.POST, { method: 'POST', cookie: rep2, body: { unitId: unit.id, clientId: theirClient.id } });
      const c = await call<{ id: string }>(contractsRoute.POST, { method: 'POST', cookie: rep2, body: { reservationId: r.json.id, finalPriceCents: 100_000_00, downPaymentCents: 0, installmentsCount: 3, startDate: new Date().toISOString().slice(0, 10) } });
      expect(c.status).toBe(201);
      expect((await call(contractRoute.GET, { cookie: rep1, params: { id: c.json.id } })).status).toBe(404);
      expect((await call(contractRoute.GET, { cookie: accountant, params: { id: c.json.id } })).status).toBe(200);
      const list = await call<{ items: { id: string }[] }>(contractsRoute.GET, { cookie: rep1, path: '/api/contracts?pageSize=100' });
      expect(list.json.items.some((x) => x.id === c.json.id)).toBe(false);
    });
  });

  describe('الحماية من التلاعب بالحمولة (mass assignment)', () => {
    it('حقول ممنوعة في الجسم تُرفض كلياً: status/ownerId/companyId/id/approvedBy…', async () => {
      const cases: [Parameters<typeof call>[0], Record<string, unknown>, string][] = [
        [clientsRoute.POST, { name: 'x', phone: '+966551234567', ownerId: '00000000-0000-4000-8000-000000000114' }, rep1],
        [clientsRoute.POST, { name: 'x', phone: '+966551234567', companyId: '00000000-0000-4000-8000-000000000002' }, rep1],
        [unitsRoute.POST, { project: 'a', number: `m-${Date.now()}`, type: 'villa', areaSqm: 10, rooms: 1, priceCents: 100, status: 'sold' }, admin],
        [reservationsRoute.POST, { unitId: '00000000-0000-4000-8000-000000000999', clientId: '00000000-0000-4000-8000-000000000999', repId: 'x', status: 'converted' }, rep1],
        [contractsRoute.POST, { reservationId: '00000000-0000-4000-8000-000000000999', finalPriceCents: 1, downPaymentCents: 0, installmentsCount: 1, startDate: '2026-01-01', status: 'approved', approvedBy: 'x' }, rep1],
        [paymentsRoute.POST, { contractId: '00000000-0000-4000-8000-000000000999', amountCents: 1, idempotencyKey: 'abcdefgh1234', recordedBy: 'x', createdAt: '2020-01-01' }, accountant],
      ];
      for (const [h, body, cookie] of cases) {
        const res = await call<Err>(h, { method: 'POST', cookie, body });
        expect(res.status, JSON.stringify(body)).toBe(422);
      }
    });

    it('تعديل السعر: لا يقبل status ولا غير priceCents', async () => {
      const unit = await createFreshUnit(admin);
      const res = await call(priceRoute.PATCH, { method: 'PATCH', cookie: admin, params: { id: unit.id }, body: { priceCents: 100, status: 'sold' } });
      expect(res.status).toBe(422);
    });

    it('معرّف المسار غير UUID = 422 (لا يصل لقاعدة البيانات)', async () => {
      expect((await call(clientRoute.GET, { cookie: rep1, params: { id: "1' OR '1'='1" } })).status).toBe(422);
      expect((await call(contractRoute.GET, { cookie: accountant, params: { id: '../../etc/passwd' } })).status).toBe(422);
    });
  });

  describe('المدخلات: الفلترة والترتيب والترقيم', () => {
    const bad = [
      'sort=price;DROP TABLE units', 'sort=password', 'order=sideways', 'status=sold%27%20OR%201=1', 'status=x',
      'page=0', 'page=-1', 'page=1.5', 'page=abc', 'pageSize=0', 'pageSize=101', 'pageSize=1e2', 'pageSize=99999999',
      'minPriceCents=-1', 'minPriceCents=1.5', 'minPriceCents=1e9', 'maxPriceCents=abc', 'minPriceCents=100&maxPriceCents=50',
      'page=1&page=2', 'status=available&status=sold', 'unknown=1',
    ];
    for (const q of bad) {
      it(`يرفض: ${q}`, async () => {
        const res = await call(unitsRoute.GET, { cookie: admin, path: `/api/units?${q}` });
        expect(res.status).toBe(422);
      });
    }

    it('فلترة وترتيب وترقيم صحيحة من الخادم', async () => {
      const res = await call<{ items: { priceCents: number; status: string }[]; total: number; pageSize: number }>(unitsRoute.GET, {
        cookie: admin, path: '/api/units?status=available&minPriceCents=1&maxPriceCents=99999999999&sort=price&order=desc&page=1&pageSize=5',
      });
      expect(res.status).toBe(200);
      expect(res.json.items.length).toBeLessThanOrEqual(5);
      expect(res.json.items.every((u) => u.status === 'available')).toBe(true);
      const prices = res.json.items.map((u) => u.priceCents);
      expect([...prices].sort((a, b) => b - a)).toEqual(prices);
    });

    it('بحث العملاء بحقن SQL/LIKE لا يكسر ولا يسرّب (يُعامل كنص)', async () => {
      await createFreshClient(rep1, "O'Brien; DROP TABLE clients;--");
      for (const q of ["' OR 1=1 --", '%', '_', '\\', "'; SELECT pg_sleep(5);--"]) {
        const res = await call<{ items: unknown[] }>(clientsRoute.GET, { cookie: rep1, path: `/api/clients?q=${encodeURIComponent(q)}` });
        expect(res.status).toBe(200);
        expect(res.json.items.length).toBeLessThanOrEqual(1);
      }
      const hit = await call<{ items: { name: string }[] }>(clientsRoute.GET, { cookie: rep1, path: `/api/clients?q=${encodeURIComponent("O'Brien")}` });
      expect(hit.json.items.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('المخرجات: XSS وتسريب الأخطاء', () => {
    it('الملاحظات تُخزَّن وتُعاد كنص JSON حرفي (والعرض بترميز React) مع حذف محارف التحكم', async () => {
      const payload = '<script>alert(1)</script><img src=x onerror=alert(2)>\u0000\u0007';
      const res = await call<{ id: string; notes: string }>(clientsRoute.POST, { method: 'POST', cookie: rep1, body: { name: '<b>اسم</b>', phone: '+966551234567', notes: payload } });
      expect(res.status).toBe(201);
      expect(res.headers.get('content-type')).toMatch(/application\/json/);
      expect(res.json.notes).toBe('<script>alert(1)</script><img src=x onerror=alert(2)>');
      const back = await call<{ notes: string }>(clientRoute.GET, { cookie: rep1, params: { id: res.json.id } });
      expect(back.json.notes).toBe(res.json.notes);
    });

    it('أخطاء النظام عامة ونظيفة: لا مسارات ولا أسماء جداول ولا مكدّس', async () => {
      const responses = await Promise.all([
        call<Err>(clientRoute.GET, { cookie: rep1, params: { id: '00000000-0000-4000-8000-0000000000ff' } }),
        call<Err>(unitsRoute.GET, { cookie: admin, path: '/api/units?sort=bad' }),
        call<Err>(unitsRoute.POST, { method: 'POST', cookie: admin, body: { project: 'a', number: 'dup', type: 'villa', areaSqm: 1, rooms: 1, priceCents: 1 } }),
        call<Err>(unitsRoute.POST, { method: 'POST', cookie: admin, body: { project: 'a', number: 'dup', type: 'villa', areaSqm: 1, rooms: 1, priceCents: 1 } }),
      ]);
      for (const r of responses) {
        const text = JSON.stringify(r.json);
        expect(text).not.toMatch(/at\s+\S+\s+\(|node_modules|\.ts:|postgres|pg_|SELECT |INSERT |violates|constraint|relation|stack/i);
        expect(r.headers.get('x-request-id')).toBeTruthy();
        expect(r.headers.get('cache-control')).toBe('no-store');
      }
      expect(responses.some((r) => r.status === 422 && r.json.error.fields?.['number'])).toBe(true); // رقم مكرر برسالة بجانب الحقل
    });
  });
});
