import { z } from 'zod';
import { rows, withTenant, type Db } from '@/lib/db';
import type { AuthContext } from './auth/context';

export const AUDIT_ACTIONS = [
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'LOGOUT',
  'UNIT_CREATED',
  'UNIT_PRICE_CHANGED',
  'RESERVATION_CREATED',
  'CONTRACT_CREATED',
  'CONTRACT_CANCELLED',
  'CONTRACT_APPROVED',
  'PAYMENT_RECORDED',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  companyId: string | null;
  actorUserId: string | null;
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  /** تفاصيل غير سرية فقط (أرقام/معرّفات). لا كلمات مرور ولا رموز أبداً. */
  details?: Record<string, string | number | boolean | null>;
  ip?: string;
}

/**
 * يكتب في سجل التدقيق داخل المعاملة نفسها التي تنفّذ العملية: إن فشلت العملية يُلغى سجلها
 * وإن نجحت فسجلها مضمون. الجدول للإضافة فقط (محفّزات + صلاحيات تمنع UPDATE/DELETE).
 * لا نستخدم RETURNING هنا (سياسة القراءة تخفي أحداث ما قبل المصادقة).
 */
export async function writeAudit(db: Db, entry: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type, entity_id, details, ip)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      entry.companyId,
      entry.actorUserId,
      entry.action,
      entry.entityType ?? null,
      entry.entityId ?? null,
      JSON.stringify(entry.details ?? {}),
      entry.ip ?? null,
    ],
  );
}

export const auditListQuery = z.strictObject({
  page: z.string().regex(/^\d{1,6}$/).transform(Number).refine((n) => n >= 1).default(1),
  pageSize: z.string().regex(/^\d{1,3}$/).transform(Number).refine((n) => n >= 1 && n <= 100).default(25),
  action: z.enum(AUDIT_ACTIONS).optional(),
});
export type AuditListQuery = z.infer<typeof auditListQuery>;

export interface AuditLogDto {
  id: number;
  action: string;
  actorName: string | null;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

export async function listAuditLogs(
  ctx: AuthContext,
  query: AuditListQuery,
): Promise<{ items: AuditLogDto[]; total: number; page: number; pageSize: number }> {
  return withTenant(ctx, async (db) => {
    const params: unknown[] = [ctx.companyId];
    let where = 'a.company_id = $1';
    if (query.action) {
      params.push(query.action);
      where += ` AND a.action = $${params.length}`;
    }
    const [{ count } = { count: '0' }] = await rows<{ count: string }>(
      db,
      `SELECT count(*)::text AS count FROM audit_logs a WHERE ${where}`,
      params,
    );
    const offset = (query.page - 1) * query.pageSize;
    const list = await rows<{
      id: string;
      action: string;
      actor_name: string | null;
      entity_type: string | null;
      entity_id: string | null;
      details: Record<string, unknown>;
      ip: string | null;
      created_at: Date;
    }>(
      db,
      `SELECT a.id::text, a.action, u.name AS actor_name, a.entity_type, a.entity_id, a.details, a.ip, a.created_at
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id AND u.company_id = a.company_id
       WHERE ${where}
       ORDER BY a.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, offset],
    );
    return {
      items: list.map((r) => ({
        id: Number(r.id),
        action: r.action,
        actorName: r.actor_name,
        entityType: r.entity_type,
        entityId: r.entity_id,
        details: r.details,
        ip: r.ip,
        createdAt: r.created_at.toISOString(),
      })),
      total: Number(count),
      page: query.page,
      pageSize: query.pageSize,
    };
  });
}
