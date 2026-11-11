'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ErrorAlert, TextInput } from '@/components/ui';
import { api, ApiError } from '@/lib/client/api';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api('/api/auth/login', { method: 'POST', body: { email, password } });
      router.replace('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'ERROR', 'حدث خطأ غير متوقع.'));
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      {error && <ErrorAlert error={error} />}
      <TextInput label="البريد الإلكتروني" type="email" autoComplete="username" dir="ltr" required value={email}
        onChange={(e) => setEmail(e.target.value)} error={error?.fields['email']} />
      <TextInput label="كلمة المرور" type="password" autoComplete="current-password" dir="ltr" required value={password}
        onChange={(e) => setPassword(e.target.value)} error={error?.fields['password']} />
      <button className="btn" type="submit" disabled={busy || !email || !password}>
        {busy ? 'جارٍ الدخول…' : 'دخول'}
      </button>
    </form>
  );
}
