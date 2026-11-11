import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { requireSession } from '@/server/auth/page-session';
import { getProfile } from '@/server/services/profile';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireSession();
  const profile = await getProfile(ctx);
  return (
    <AppShell session={{ name: ctx.name, role: ctx.role, companyName: profile.company.name, currency: profile.company.currency }}>
      {children}
    </AppShell>
  );
}
