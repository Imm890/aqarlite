import { expect } from 'vitest';
import type { NextRouteContext } from '@/server/http';

export const TEST_PASSWORD = 'Test-Passw0rd-2026!';
export const ORIGIN = 'http://localhost:3000';
export const COOKIE_NAME = 'aqarlite_sid';

type Handler = (req: Request, ctx?: NextRouteContext) => Promise<Response>;

export interface CallOptions {
  method?: string;
  path?: string;
  body?: unknown;
  rawBody?: string;
  cookie?: string | undefined;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  origin?: string | null;
}

export interface ApiResponse<T = Record<string, unknown>> {
  status: number;
  json: T;
  setCookie: string[];
  headers: Headers;
}

export async function call<T = Record<string, unknown>>(handler: Handler, opts: CallOptions = {}): Promise<ApiResponse<T>> {
  const method = opts.method ?? 'GET';
  const headers = new Headers(opts.headers);
  if (opts.cookie) headers.set('cookie', opts.cookie);
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin !== null && method !== 'GET') headers.set('origin', origin);
  const hasBody = opts.body !== undefined || opts.rawBody !== undefined;
  if (hasBody && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const req = new Request(`${ORIGIN}${opts.path ?? '/api/test'}`, {
    method,
    headers,
    ...(hasBody ? { body: opts.rawBody ?? JSON.stringify(opts.body) } : {}),
  });
  const routeCtx: NextRouteContext = { params: Promise.resolve(opts.params ?? {}) };
  const res = await handler(req, routeCtx);
  const text = await res.text();
  return {
    status: res.status,
    json: (text ? JSON.parse(text) : {}) as T,
    setCookie: res.headers.getSetCookie(),
    headers: res.headers,
  };
}

export function cookieFrom(setCookie: string[]): string {
  const raw = setCookie.find((c) => c.startsWith(`${COOKIE_NAME}=`));
  expect(raw, 'session cookie must be set').toBeTruthy();
  return (raw ?? '').split(';')[0] ?? '';
}

export type Account =
  | 'ofuq-admin' | 'ofuq-accountant' | 'ofuq-rep1' | 'ofuq-rep2'
  | 'nokhba-admin' | 'nokhba-accountant' | 'nokhba-rep1' | 'nokhba-rep2';

export async function loginAs(account: Account): Promise<string> {
  const { POST } = await import('@/app/api/auth/login/route');
  const [company, local] = account.split('-') as [string, string];
  const res = await call(POST, {
    method: 'POST',
    path: '/api/auth/login',
    body: { email: `${local}@${company}.example`, password: TEST_PASSWORD },
  });
  expect(res.status, `login ${account}`).toBe(200);
  return cookieFrom(res.setCookie);
}

/** معرّفات الـ seed الثابتة */
export const COMPANY = { ofuq: '00000000-0000-4000-8000-000000000001', nokhba: '00000000-0000-4000-8000-000000000002' } as const;

export interface Unit { id: string; project: string; number: string; priceCents: number; status: string }
export interface Client { id: string; name: string }

let unitCounter = 0;
/** ينشئ وحدة جديدة متاحة عبر API المدير (لعزل الاختبارات عن بعضها). */
export async function createFreshUnit(adminCookie: string, priceCents = 100_000_00): Promise<Unit> {
  const { POST } = await import('@/app/api/units/route');
  unitCounter += 1;
  const res = await call<Unit>(POST, {
    method: 'POST',
    path: '/api/units',
    cookie: adminCookie,
    body: {
      project: `مشروع اختبار ${process.pid}`,
      number: `T-${Date.now()}-${unitCounter}-${Math.floor(Math.random() * 1e6)}`,
      type: 'apartment',
      areaSqm: 120.5,
      rooms: 3,
      priceCents,
    },
  });
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return res.json;
}

export async function createFreshClient(repCookie: string, name = 'عميل اختبار'): Promise<Client> {
  const { POST } = await import('@/app/api/clients/route');
  const res = await call<Client>(POST, {
    method: 'POST',
    path: '/api/clients',
    cookie: repCookie,
    body: { name, phone: '+966551234567', notes: 'ملاحظة' },
  });
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return res.json;
}
