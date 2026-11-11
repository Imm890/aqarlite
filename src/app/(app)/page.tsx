import { redirect } from 'next/navigation';
import { requireSession } from '@/server/auth/page-session';

export default async function Home() {
  const ctx = await requireSession();
  redirect(ctx.role === 'accountant' ? '/contracts' : '/units');
}
