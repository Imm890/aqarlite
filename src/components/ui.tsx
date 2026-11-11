'use client';

import { useEffect, useId, useRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import type { ApiError } from '@/lib/client/api';

export function ErrorAlert({ error, onRetry }: { error: ApiError | Error | string; onRetry?: () => void }) {
  const message = typeof error === 'string' ? error : error.message;
  return (
    <div className="alert error" role="alert">
      <span>{message}</span>{' '}
      {onRetry && (
        <button type="button" className="btn small secondary" onClick={onRetry}>
          إعادة المحاولة
        </button>
      )}
    </div>
  );
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">جارٍ التحميل…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" />
      ))}
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <p><strong>{title}</strong></p>
      {hint && <p>{hint}</p>}
      {action}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className="pager" aria-label="ترقيم الصفحات">
      <span>
        الإجمالي: <span className="num">{total}</span> — الصفحة <span className="num">{page}</span> من <span className="num">{pages}</span>
      </span>
      <span className="actions">
        <button type="button" className="btn secondary small" disabled={page <= 1} onClick={() => onPage(page - 1)}>السابق</button>
        <button type="button" className="btn secondary small" disabled={page >= pages} onClick={() => onPage(page + 1)}>التالي</button>
      </span>
    </nav>
  );
}

interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: string;
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby': string | undefined }) => ReactNode;
}

/** حقل مع تسمية ورسالة تحقق بجانبه (أسفله) مرتبطة بقارئات الشاشة. */
export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId();
  const errId = `${id}-err`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': error ? errId : undefined })}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span id={errId} className="field-error">{error}</span>}
    </div>
  );
}

export function TextInput({ label, error, hint, ...rest }: { label: string; error?: string | undefined; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <Field label={label} error={error} {...(hint ? { hint } : {})}>{(p) => <input className="input" {...p} {...rest} />}</Field>;
}

export function SelectInput({ label, error, children, ...rest }: { label: string; error?: string | undefined } & SelectHTMLAttributes<HTMLSelectElement>) {
  return <Field label={label} error={error}>{(p) => <select className="input" {...p} {...rest}>{children}</select>}</Field>;
}

export function TextArea({ label, error, ...rest }: { label: string; error?: string | undefined } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <Field label={label} error={error}>{(p) => <textarea className="input" rows={4} {...p} {...rest} />}</Field>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="page-head"><h2>{title}</h2><button type="button" className="btn secondary small" onClick={onClose} aria-label="إغلاق">✕</button></div>
        {children}
      </div>
    </div>
  );
}

export function Badge({ kind, children }: { kind: string; children: ReactNode }) {
  return <span className={`badge ${kind}`}>{children}</span>;
}

/** يعرض رقماً/مبلغاً/تاريخاً باتجاه LTR داخل نص RTL. */
export function Num({ children }: { children: ReactNode }) {
  return <span className="num">{children}</span>;
}
