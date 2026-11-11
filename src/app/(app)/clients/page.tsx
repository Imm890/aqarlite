import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { can } from '@/domain/permissions';
import { requireSession } from '@/server/auth/page-session';
import { ClientsView } from './ClientsView';

export const metadata: Metadata = { title: 'العملاء' };

export default async function ClientsPage() {
  const ctx = await requireSession();
  if (!can(ctx.role, 'client:read_own') && !can(ctx.role, 'client:read_all')) redirect('/');
  return <ClientsView />;
}
