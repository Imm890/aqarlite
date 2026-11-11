import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { readSessionToken } from './cookies';
import { resolveSession } from './session';
import type { AuthContext } from './context';

/**
 * يُستدعى في كل layout/صفحة محمية (خادم): يتحقق من الجلسة في قاعدة البيانات فعلياً
 * (وليس بوجود الكوكي فقط) ويحوّل إلى /login إن لم تصلح. البيانات نفسها تُجلب عبر /api
 * التي تعيد فرض الجلسة والدور والملكية في كل طلب.
 */
export async function requireSession(): Promise<AuthContext> {
  const jar = await cookies();
  const header = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  const ctx = await resolveSession(readSessionToken(header));
  if (!ctx) redirect('/login');
  return ctx;
}
