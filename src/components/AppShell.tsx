'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { createContext, useContext } from 'react';
import { api } from '@/lib/client/api';
import { ROLE_LABEL } from '@/lib/client/format';
import { can, type Role } from '@/domain/permissions';

export interface SessionInfo {
  name: string;
  role: Role;
  companyName: string;
  currency: string;
}
const SessionContext = createContext<SessionInfo | null>(null);

export function useSession(): SessionInfo {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession must be used inside AppShell');
  return s;
}

/**
 * ملاحظة: إخفاء الروابط/الأزرار بحسب الدور هنا تحسين تجربة فقط. الصلاحية الحقيقية تُفرض في
 * الخادم على كل طلب (apiRoute) فلا يفيد أحداً تعديل الواجهة.
 */
export function AppShell({ session, children }: { session: SessionInfo; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const links: { href: string; label: string; show: boolean }[] = [
    { href: '/units', label: 'الوحدات', show: true },
    { href: '/clients', label: 'العملاء', show: can(session.role, 'client:read_own') || can(session.role, 'client:read_all') },
    { href: '/reservations', label: 'الحجوزات', show: can(session.role, 'reservation:read_own') || can(session.role, 'reservation:read_all') },
    { href: '/contracts', label: 'العقود', show: can(session.role, 'contract:read_own') || can(session.role, 'contract:read_all') },
    { href: '/audit', label: 'سجل التدقيق', show: can(session.role, 'audit:read') },
  ];

  async function logout(): Promise<void> {
    setBusy(true);
    try {
      await api('/api/auth/logout', { method: 'POST', body: {} });
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <SessionContext.Provider value={session}>
      <div className="shell">
        <header className="topbar">
          <div className="topbar-in">
            <span className="brand">عقارلايت</span>
            <nav className="nav" aria-label="التنقل الرئيسي">
              {links.filter((l) => l.show).map((l) => (
                <Link key={l.href} href={l.href} aria-current={pathname.startsWith(l.href) ? 'page' : undefined}>{l.label}</Link>
              ))}
            </nav>
            <div className="who">
              <span className="name">{session.name} · {ROLE_LABEL[session.role]} · {session.companyName}</span>
              <button type="button" className="btn secondary small" onClick={logout} disabled={busy}>تسجيل الخروج</button>
            </div>
          </div>
        </header>
        <main className="main">{children}</main>
      </div>
    </SessionContext.Provider>
  );
}
