import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Permission } from '@/domain/permissions';
import { mapDbError } from '@/lib/db-errors';
import { AppError, Errors } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { configureZodArabic } from '@/lib/zod-ar';
import { authorizeAny, type AuthContext } from './auth/context';
import { readSessionToken } from './auth/cookies';
import { resolveSession } from './auth/session';
import { assertSameOrigin } from './csrf';
import { getClientIp } from './request';

configureZodArabic();

const MAX_BODY_BYTES = 64 * 1024;

export interface ApiResult {
  status: number;
  data: unknown;
  setCookies?: string[];
}
export const ok = (data: unknown, extra: Partial<ApiResult> = {}): ApiResult => ({ status: 200, data, ...extra });
export const created = (data: unknown): ApiResult => ({ status: 201, data });

type RouteParams = Record<string, string | string[] | undefined>;
export interface NextRouteContext {
  params: Promise<RouteParams>;
}

interface Schemas<P, Q, B> {
  params?: z.ZodType<P>;
  query?: z.ZodType<Q>;
  body?: z.ZodType<B>;
}

interface BaseArgs<P, Q, B> {
  params: P;
  query: Q;
  body: B;
  req: Request;
  ip: string;
  requestId: string;
}

export interface ProtectedRouteSpec<P, Q, B> extends Schemas<P, Q, B> {
  /**
   * صلاحية واحدة أو عدة صلاحيات (يكفي توفر إحداها؛ والخدمة تحدّد النطاق حسب الدور)،
   * أو 'authenticated' لأي مستخدم مسجّل (me/logout فقط).
   */
  permission: Permission | readonly Permission[] | 'authenticated';
  handler: (args: BaseArgs<P, Q, B> & { ctx: AuthContext; token: string }) => Promise<ApiResult>;
}

export interface PublicRouteSpec<P, Q, B> extends Schemas<P, Q, B> {
  handler: (args: BaseArgs<P, Q, B>) => Promise<ApiResult>;
}

type RouteHandler = (req: Request, routeCtx?: NextRouteContext) => Promise<Response>;

function formatIssues(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) fields[key] ??= 'حقل غير مسموح.';
      continue;
    }
    const key = issue.path.map(String).join('.') || '_';
    fields[key] ??= issue.message;
  }
  return fields;
}

function parseWith<T>(schema: z.ZodType<T> | undefined, input: unknown): T {
  if (!schema) return undefined as T;
  const result = schema.safeParse(input);
  if (!result.success) throw Errors.validation(formatIssues(result.error));
  return result.data;
}

function queryToObject(url: URL): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of url.searchParams) {
    const existing = out[key];
    if (existing === undefined) out[key] = value;
    else out[key] = Array.isArray(existing) ? [...existing, value] : [existing, value]; // التكرار يُرفض في المخطط
  }
  return out;
}

async function readJsonBody(req: Request): Promise<unknown> {
  const type = req.headers.get('content-type') ?? '';
  if (!/^application\/json\s*(;|$)/i.test(type)) {
    throw new AppError('BAD_REQUEST', 415, 'نوع المحتوى غير مدعوم.');
  }
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) throw new AppError('BAD_REQUEST', 413, 'حجم الطلب كبير جداً.');
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new AppError('BAD_REQUEST', 413, 'حجم الطلب كبير جداً.');
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw Errors.badRequest('الطلب ليس JSON صالحاً.');
  }
}

function toResponse(result: ApiResult, requestId: string): Response {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'X-Request-Id': requestId,
  });
  for (const cookie of result.setCookies ?? []) headers.append('Set-Cookie', cookie);
  return Response.json(result.data, { status: result.status, headers });
}

function errorResponse(error: AppError, requestId: string): Response {
  const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Request-Id': requestId });
  return Response.json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.fields ? { fields: error.fields } : {}),
        requestId,
      },
    },
    { status: error.status, headers },
  );
}

/** يحوّل أي استثناء إلى AppError عام. التفاصيل التقنية تُسجَّل في الخادم فقط. */
function normalizeError(error: unknown, requestId: string, context: Record<string, unknown>): AppError {
  if (error instanceof AppError) return error;
  const mapped = mapDbError(error);
  if (mapped) {
    logger.warn('db constraint rejected request', { requestId, ...context, error });
    return mapped;
  }
  logger.error('unhandled error', { requestId, ...context, error });
  return Errors.internal();
}

async function parseInputs<P, Q, B>(
  req: Request,
  routeCtx: NextRouteContext | undefined,
  schemas: Schemas<P, Q, B>,
): Promise<{ params: P; query: Q; body: B }> {
  const rawParams = routeCtx ? await routeCtx.params : {};
  const params = parseWith(schemas.params, rawParams);
  const query = parseWith(schemas.query, queryToObject(new URL(req.url)));
  const body = schemas.body ? parseWith(schemas.body, await readJsonBody(req)) : (undefined as B);
  return { params, query, body };
}

/**
 * نقطة نهاية محمية: CSRF → مصادقة (جلسة خادم) → تفويض (دور) → تحقق مدخلات صارم → المعالج.
 * التحقق من الصلاحية هنا في الخادم لكل طلب؛ لا يُعتمد على الواجهة إطلاقاً.
 */
export function apiRoute<P = undefined, Q = undefined, B = undefined>(
  spec: ProtectedRouteSpec<P, Q, B>,
): RouteHandler {
  const permissions: readonly Permission[] | null =
    spec.permission === 'authenticated'
      ? null
      : Array.isArray(spec.permission)
        ? (spec.permission as readonly Permission[])
        : [spec.permission as Permission];

  return async (req, routeCtx) => {
    const requestId = randomUUID();
    const context: Record<string, unknown> = { method: req.method, path: new URL(req.url).pathname };
    try {
      assertSameOrigin(req);
      const token = readSessionToken(req.headers.get('cookie'));
      const ctx = await resolveSession(token);
      if (!ctx || !token) throw Errors.unauthenticated();
      context['userId'] = ctx.userId;
      context['companyId'] = ctx.companyId;
      if (permissions) authorizeAny(ctx, permissions);

      const inputs = await parseInputs(req, routeCtx, spec);
      const result = await spec.handler({ ...inputs, ctx, token, req, ip: getClientIp(req), requestId });
      return toResponse(result, requestId);
    } catch (error) {
      return errorResponse(normalizeError(error, requestId, context), requestId);
    }
  };
}

/** نقطة نهاية عامة (الدخول فقط): تبقى محمية بفحص CSRF والتحقق الصارم. */
export function publicRoute<P = undefined, Q = undefined, B = undefined>(
  spec: PublicRouteSpec<P, Q, B>,
): RouteHandler {
  return async (req, routeCtx) => {
    const requestId = randomUUID();
    const context: Record<string, unknown> = { method: req.method, path: new URL(req.url).pathname };
    try {
      assertSameOrigin(req);
      const inputs = await parseInputs(req, routeCtx, spec);
      const result = await spec.handler({ ...inputs, req, ip: getClientIp(req), requestId });
      return toResponse(result, requestId);
    } catch (error) {
      return errorResponse(normalizeError(error, requestId, context), requestId);
    }
  };
}
