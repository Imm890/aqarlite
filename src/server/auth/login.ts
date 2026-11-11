import { z } from 'zod';
import { isRole, type Role } from '@/domain/permissions';
import { rows, withTenant, withoutTenant } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { writeAudit } from '../audit';
import { getDummyHash, verifyPassword } from './password';
import { assertLoginAllowed, normalizeEmail, recordLoginAttempt } from './rate-limit';
import { createSession, revokeSession } from './session';
import type { AuthContext } from './context';

export const loginBody = z.strictObject({
  email: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(256),
});
export type LoginBody = z.infer<typeof loginBody>;

/** رسالة واحدة لكل أسباب الفشل: لا تكشف إن كان البريد مسجلاً أم لا. */
const INVALID_CREDENTIALS = (): AppError =>
  new AppError('UNAUTHENTICATED', 401, 'البريد الإلكتروني أو كلمة المرور غير صحيحة.');

interface LoginRow {
  user_id: string;
  company_id: string;
  role: string;
  name: string;
  password_hash: string;
  is_active: boolean;
}

export interface LoginResult {
  token: string;
  user: { id: string; name: string; email: string; role: Role };
}

export async function login(input: LoginBody, ip: string): Promise<LoginResult> {
  const email = normalizeEmail(input.email);

  await assertLoginAllowed(email, ip);

  const found = (
    await withoutTenant((db) => rows<LoginRow>(db, 'SELECT * FROM auth_find_login($1)', [email]))
  )[0];

  // نتحقق دائماً من تجزئة (حقيقية أو وهمية) ليتساوى زمن الاستجابة تقريباً في الحالتين
  const passwordOk = await verifyPassword(found?.password_hash ?? (await getDummyHash()), input.password);

  if (!found || !found.is_active || !passwordOk || !isRole(found.role)) {
    await recordLoginAttempt(email, ip, false);
    const auditEntry = {
      companyId: found?.company_id ?? null,
      actorUserId: found?.user_id ?? null,
      action: 'LOGIN_FAILED' as const,
      details: { email },
      ip,
    };
    if (found) {
      // الشركة هنا مصدرها قاعدة البيانات (صاحب البريد) وليس الطلب
      await withTenant({ companyId: found.company_id }, (db) => writeAudit(db, auditEntry));
    } else {
      await withoutTenant((db) => writeAudit(db, auditEntry));
    }
    throw INVALID_CREDENTIALS();
  }

  await recordLoginAttempt(email, ip, true);
  const token = await createSession(found.user_id);
  await withTenant({ companyId: found.company_id }, (db) =>
    writeAudit(db, {
      companyId: found.company_id,
      actorUserId: found.user_id,
      action: 'LOGIN_SUCCESS',
      ip,
    }),
  );
  return { token, user: { id: found.user_id, name: found.name, email, role: found.role } };
}

export async function logout(ctx: AuthContext, token: string, ip: string): Promise<void> {
  await revokeSession(token);
  await withTenant(ctx, (db) =>
    writeAudit(db, { companyId: ctx.companyId, actorUserId: ctx.userId, action: 'LOGOUT', ip }),
  );
}
