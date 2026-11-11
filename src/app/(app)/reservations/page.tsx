import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { can } from '@/domain/permissions';
import { requireSession } from '@/server/auth/page-session';
import { ReservationsView } from './ReservationsView';

export const metadata: Metadata = { title: 'الحجوزات' };

export default async function ReservationsPage() {
  const ctx = await requireSession();
  if (!can(ctx.role, 'reservation:read_own') && !can(ctx.role, 'reservation:read_all')) redirect('/');
  return <ReservationsView />;
}
