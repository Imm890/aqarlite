import { can, type Permission, type Role } from '@/domain/permissions';
import { Errors } from '@/lib/errors';

/**
 * هوية المستخدم الحالي كما تُحلّ من الجلسة في الخادم.
 * companyId يأتي من الجلسة حصراً — لا يُقرأ أبداً من جسم الطلب أو الاستعلام أو المسار.
 */
export interface AuthContext {
  readonly sessionId: string;
  readonly userId: string;
  readonly companyId: string;
  readonly role: Role;
  readonly name: string;
  readonly email: string;
}

export function authorize(ctx: AuthContext, permission: Permission): void {
  if (!can(ctx.role, permission)) throw Errors.forbidden();
}

export function authorizeAny(ctx: AuthContext, permissions: readonly Permission[]): void {
  if (!permissions.some((p) => can(ctx.role, p))) throw Errors.forbidden();
}
