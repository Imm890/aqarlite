import type { Metadata } from 'next';
import { requireSession } from '@/server/auth/page-session';
import { can } from '@/domain/permissions';
import { redirect } from 'next/navigation';
import { AuditView } from './AuditView';

export const metadata: Metadata = { title: 'سجل التدقيق' };

export default async function AuditPage() {
  const ctx = await requireSession();
  if (!can(ctx.role, 'audit:read')) redirect('/');
  return <AuditView />;
}
