import { z } from 'zod';
import { can } from '@/domain/permissions';
import { normalizeDigits } from '@/domain/money';
import { oneRow, rows, withTenant } from '@/lib/db';
import { Errors } from '@/lib/errors';
import type { AuthContext } from '../auth/context';
import { escapeLike, pageQuery, pageSizeQuery, toInt, type Page } from './common';

export interface ClientDto {
  id: string;
  name: string;
  phone: string;
  notes: string;
  ownerId: string;
  ownerName: string;
  createdAt: string;
}

/** يزيل مسافات وشرطات وأقواس من الهاتف ويحوّل الأرقام العربية، ثم يتحقق من الصيغة الدولية. */
const phoneSchema = z
  .string()
  .max(40)
  .transform((v) => normalizeDigits(v).replace(/[\s\-().]/g, ''))
  .pipe(z.string().regex(/^\+?[0-9]{7,15}$/, 'رقم هاتف غير صالح (7–15 رقماً، ويمكن أن يبدأ بـ +).'));

/** يحذف محارف التحكم (عدا \t و\n و\r) بمقارنة رمز المحرف بدل تعبير نمطي فيه محارف تحكم. */
function stripControlChars(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    const isControl = (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
    if (!isControl) out += ch;
  }
  return out;
}

/** ملاحظات نصية حرة: نحذف محارف التحكم (عدا السطر الجديد/التبويب). الحماية من XSS عند العرض بالترميز. */
const notesSchema = z
  .string()
  .max(2000)
  .transform((v) => stripControlChars(v).trim())
  .default('');

export const createClientBody = z.strictObject({
  name: z.string().trim().min(1).max(120),
  phone: phoneSchema,
  notes: notesSchema,
});
export type CreateClientBody = z.infer<typeof createClientBody>;

export const clientListQuery = z.strictObject({
  q: z.string().trim().min(1).max(60).optional(),
  page: pageQuery,
  pageSize: pageSizeQuery,
});
export type ClientListQuery = z.infer<typeof clientListQuery>;

interface ClientRow {
  id: string;
  name: string;
  phone: string;
  notes: string;
  owner_id: string;
  owner_name: string;
  created_at: Date;
}

const CLIENT_SELECT = `c.id, c.name, c.phone, c.notes, c.owner_id, o.name AS owner_name, c.created_at
  FROM clients c JOIN users o ON o.id = c.owner_id AND o.company_id = c.company_id`;

const toDto = (r: ClientRow): ClientDto => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  notes: r.notes,
  ownerId: r.owner_id,
  ownerName: r.owner_name,
  createdAt: r.created_at.toISOString(),
});

/**
 * نطاق الرؤية: المدير يرى كل عملاء شركته، والمندوب عملاءه هو فقط.
 * (الشركة والمالك يأتيان من الجلسة، ولا يوجد أي معامل طلب يغيّرهما.)
 */
function scope(ctx: AuthContext, params: unknown[]): string {
  params.push(ctx.companyId);
  let sql = `c.company_id = $${params.length}`;
  if (!can(ctx.role, 'client:read_all')) {
    if (!can(ctx.role, 'client:read_own')) throw Errors.forbidden();
    params.push(ctx.userId);
    sql += ` AND c.owner_id = $${params.length}`;
  }
  return sql;
}

export async function createClient(ctx: AuthContext, body: CreateClientBody): Promise<ClientDto> {
  return withTenant(ctx, async (db) => {
    const inserted = await oneRow<{ id: string }>(
      db,
      `INSERT INTO clients (company_id, owner_id, name, phone, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [ctx.companyId, ctx.userId, body.name, body.phone, body.notes],
    );
    if (!inserted) throw Errors.internal();
    const row = await oneRow<ClientRow>(db, `SELECT ${CLIENT_SELECT} WHERE c.id = $1`, [inserted.id]);
    if (!row) throw Errors.internal();
    return toDto(row);
  });
}

export async function listClients(ctx: AuthContext, query: ClientListQuery): Promise<Page<ClientDto>> {
  return withTenant(ctx, async (db) => {
    const params: unknown[] = [];
    const where = [scope(ctx, params)];
    if (query.q) {
      params.push(`%${escapeLike(query.q)}%`);
      where.push(`(c.name ILIKE $${params.length} OR c.phone ILIKE $${params.length})`);
    }
    const whereSql = where.join(' AND ');
    const total = await oneRow<{ count: string }>(
      db,
      `SELECT count(*)::text AS count FROM clients c WHERE ${whereSql}`,
      params,
    );
    const list = await rows<ClientRow>(
      db,
      `SELECT ${CLIENT_SELECT} WHERE ${whereSql}
       ORDER BY c.created_at DESC, c.id
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return { items: list.map(toDto), total: toInt(total?.count ?? '0'), page: query.page, pageSize: query.pageSize };
  });
}

/** عميل مندوب آخر (أو شركة أخرى) = غير موجود (404) لا "ممنوع"، حتى لا يُكشف وجوده. */
export async function getClient(ctx: AuthContext, clientId: string): Promise<ClientDto> {
  return withTenant(ctx, async (db) => {
    const params: unknown[] = [];
    const scopeSql = scope(ctx, params);
    params.push(clientId);
    const row = await oneRow<ClientRow>(
      db,
      `SELECT ${CLIENT_SELECT} WHERE ${scopeSql} AND c.id = $${params.length}`,
      params,
    );
    if (!row) throw Errors.notFound('العميل');
    return toDto(row);
  });
}
