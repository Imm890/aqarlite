import type { Metadata } from 'next';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'تسجيل الدخول' };
export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1>عقارلايت</h1>
        <p className="hint">سجّل الدخول للمتابعة</p>
        <LoginForm />
      </div>
    </div>
  );
}
