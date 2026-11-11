import { oneRow, withTenant } from '@/lib/db';
import type { AuthContext } from '../auth/context';

export interface ProfileDto {
  user: { id: string; name: string; email: string; role: AuthContext['role'] };
  company: { name: string; currency: string };
}

export async function getProfile(ctx: AuthContext): Promise<ProfileDto> {
  const company = await withTenant(ctx, (db) =>
    oneRow<{ name: string; currency_code: string }>(db, 'SELECT name, currency_code FROM companies WHERE id = $1', [ctx.companyId]),
  );
  return {
    user: { id: ctx.userId, name: ctx.name, email: ctx.email, role: ctx.role },
    company: { name: company?.name ?? '', currency: company?.currency_code ?? 'SAR' },
  };
}
