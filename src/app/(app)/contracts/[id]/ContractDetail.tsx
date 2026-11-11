'use client';

import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { Badge, ErrorAlert, Loading, Num, TextInput } from '@/components/ui';
import { useSession } from '@/components/AppShell';
import { can } from '@/domain/permissions';
import { parseMoneyToCents } from '@/domain/money';
import { api, ApiError, useApi } from '@/lib/client/api';
import { CONTRACT_STATUS_LABEL, dateTime, INSTALLMENT_STATUS_LABEL, money } from '@/lib/client/format';

interface Inst { id: string; sequence: number; kind: string; dueDate: string; amountCents: number; paidCents: number; remainingCents: number; status: string }
interface Detail {
  id: string; status: string; unitLabel: string; clientName: string; clientPhone: string; repName: string; approvedByName: string | null;
  unitPriceCents: number; discountCents: number; finalPriceCents: number; downPaymentCents: number; installmentsCount: number;
  paidCents: number; remainingCents: number; overdueCents: number; startDate: string; createdAt: string; approvedAt: string | null;
  schedulePreview: boolean; installments: Inst[];
  payments: { id: string; amountCents: number; createdAt: string; recordedByName: string; allocations: { sequence: number; amountCents: number }[] }[];
}

export function ContractDetail({ id }: { id: string }) {
  const session = useSession();
  const { data, error, loading, reload } = useApi<Detail>(`/api/contracts/${encodeURIComponent(id)}`);
  const [actionError, setActionError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const cur = session.currency;

  async function act(path: string, ok: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await api(path, { method: 'POST', body: {} });
      setNotice(ok);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err : undefined);
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head"><h1>تفاصيل العقد</h1><Link href="/contracts" className="btn secondary small">← العقود</Link></div>
      {loading && !data && <Loading rows={5} />}
      {error && <ErrorAlert error={error.status === 404 ? 'العقد غير موجود.' : error} onRetry={error.status === 404 ? undefined : reload} />}
      {notice && <div className="alert ok" role="status">{notice}</div>}
      {actionError && <ErrorAlert error={actionError} />}
      {data && (
        <>
          <div className="card">
            <div className="page-head">
              <h2>{data.unitLabel} <Badge kind={data.status}>{CONTRACT_STATUS_LABEL[data.status]}</Badge></h2>
              <div className="actions">
                {data.status === 'draft' && can(session.role, 'contract:approve') && (
                  <button className="btn" type="button" disabled={busy} onClick={() => act(`/api/contracts/${id}/approve`, 'تم اعتماد العقد وتوليد جدول الأقساط.')}>
                    {busy ? 'جارٍ الاعتماد…' : 'اعتماد العقد'}
                  </button>
                )}
                {data.status === 'draft' && can(session.role, 'contract:cancel_own_draft') && (
                  <button className="btn danger" type="button" disabled={busy} onClick={() => act(`/api/contracts/${id}/cancel`, 'تم إلغاء المسودة.')}>إلغاء المسودة</button>
                )}
              </div>
            </div>
            {data.status === 'draft' && <div className="alert warn">مسودة: الجدول أدناه معاينة، ويُثبَّت عند الاعتماد، وبعدها لا يُعدَّل العقد.</div>}
            <div className="grid">
              <div className="stat"><span>العميل</span><b>{data.clientName}</b><Num>{data.clientPhone}</Num></div>
              <div className="stat"><span>المندوب</span><b>{data.repName}</b></div>
              <div className="stat"><span>سعر الوحدة</span><b><Num>{money(data.unitPriceCents, cur)}</Num></b></div>
              <div className="stat"><span>الخصم</span><b><Num>{money(data.discountCents, cur)}</Num></b></div>
              <div className="stat"><span>السعر النهائي</span><b><Num>{money(data.finalPriceCents, cur)}</Num></b></div>
              <div className="stat"><span>الدفعة الأولى</span><b><Num>{money(data.downPaymentCents, cur)}</Num></b></div>
              <div className="stat"><span>عدد الأقساط</span><b><Num>{data.installmentsCount}</Num></b></div>
              <div className="stat"><span>تاريخ البداية</span><b><Num>{data.startDate}</Num></b></div>
              {data.approvedAt && <div className="stat"><span>اعتُمد بواسطة</span><b>{data.approvedByName}</b>{dateTime(data.approvedAt)}</div>}
            </div>
          </div>

          {data.status === 'approved' && (
            <div className="card">
              <div className="grid">
                <div className="stat"><span>المدفوع</span><b><Num>{money(data.paidCents, cur)}</Num></b></div>
                <div className="stat"><span>المتبقي</span><b><Num>{money(data.remainingCents, cur)}</Num></b></div>
                <div className="stat"><span>المتأخر</span><b><Num>{money(data.overdueCents, cur)}</Num></b></div>
              </div>
              <ProgressBar paid={data.paidCents} total={data.finalPriceCents} />
            </div>
          )}

          <div className="card table-wrap">
            <h2>جدول الأقساط</h2>
            <table>
              <thead><tr><th>#</th><th>النوع</th><th>الاستحقاق</th><th>المبلغ</th><th>المسدَّد</th><th>المتبقي</th><th>الحالة</th></tr></thead>
              <tbody>
                {data.installments.map((i) => (
                  <tr key={i.id}>
                    <td data-label="#"><Num>{i.sequence}</Num></td>
                    <td data-label="النوع">{i.kind === 'down_payment' ? 'دفعة أولى' : 'قسط شهري'}</td>
                    <td data-label="الاستحقاق"><Num>{i.dueDate}</Num></td>
                    <td data-label="المبلغ"><Num>{money(i.amountCents, cur)}</Num></td>
                    <td data-label="المسدَّد"><Num>{money(i.paidCents, cur)}</Num></td>
                    <td data-label="المتبقي"><Num>{money(i.remainingCents, cur)}</Num></td>
                    <td data-label="الحالة"><Badge kind={i.status}>{INSTALLMENT_STATUS_LABEL[i.status]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.status === 'approved' && can(session.role, 'payment:create') && data.remainingCents > 0 && (
            <PaymentForm contractId={data.id} remaining={data.remainingCents} currency={cur} onSaved={(m) => { setNotice(m); reload(); }} />
          )}

          {data.payments.length > 0 && (
            <div className="card table-wrap">
              <h2>الدفعات المسجّلة</h2>
              <table>
                <thead><tr><th>التاريخ</th><th>المبلغ</th><th>سجّلها</th><th>التوزيع على الأقساط</th></tr></thead>
                <tbody>
                  {data.payments.map((p) => (
                    <tr key={p.id}>
                      <td data-label="التاريخ">{dateTime(p.createdAt)}</td>
                      <td data-label="المبلغ"><Num>{money(p.amountCents, cur)}</Num></td>
                      <td data-label="سجّلها">{p.recordedByName}</td>
                      <td data-label="التوزيع">{p.allocations.map((a) => `#${a.sequence}: ${money(a.amountCents, cur)}`).join('، ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}

function ProgressBar({ paid, total }: { paid: number; total: number }) {
  // نسبة العرض بالأعداد الصحيحة (نقاط أساس) كي لا يدخل float في حساب مالي
  const bp = total === 0 ? 0 : Math.min(10_000, Math.trunc((paid * 10_000) / total));
  const cls = `progress-${Math.round(bp / 500) * 5}`;
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.trunc(bp / 100)} aria-label="نسبة السداد">
      <i className={cls} />
    </div>
  );
}

function PaymentForm({ contractId, remaining, currency, onSaved }: { contractId: string; remaining: number; currency: string; onSaved: (m: string) => void }) {
  const [amount, setAmount] = useState('');
  const [local, setLocal] = useState<string>();
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);
  // مفتاح منع التكرار: يُولَّد مرة لكل "نية دفع" ويبقى ثابتاً عند الضغط المتكرر أو إعادة المحاولة بعد انقطاع الشبكة،
  // ولا يتجدد إلا بعد نجاح الحفظ أو تغيير المبلغ.
  const keyRef = useRef<{ key: string; amount: string }>({ key: crypto.randomUUID(), amount: '' });

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    const cents = parseMoneyToCents(amount);
    if (cents === null || cents < 1) { setLocal('أدخل مبلغاً صحيحاً أكبر من صفر (بحد أقصى خانتين عشريتين).'); return; }
    if (cents > remaining) { setLocal('المبلغ يتجاوز المتبقي من العقد.'); return; }
    setLocal(undefined);
    if (keyRef.current.amount !== amount) keyRef.current = { key: crypto.randomUUID(), amount };
    setBusy(true);
    setError(undefined);
    try {
      await api('/api/payments', { method: 'POST', body: { contractId, amountCents: cents, idempotencyKey: keyRef.current.key } });
      keyRef.current = { key: crypto.randomUUID(), amount: '' };
      setAmount('');
      onSaved('تم تسجيل الدفعة وتوزيعها على أقدم الأقساط.');
    } catch (err) {
      setError(err instanceof ApiError ? err : undefined); // نُبقي نفس المفتاح: إعادة الضغط لا تنتج دفعة ثانية
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit} noValidate>
      <h2>تسجيل دفعة</h2>
      {error && <ErrorAlert error={error} />}
      <TextInput label="المبلغ" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)}
        error={local ?? error?.fields['amountCents']} hint={`المتبقي: ${money(remaining, currency)}`} />
      <button className="btn" type="submit" disabled={busy}>{busy ? 'جارٍ التسجيل…' : 'تسجيل الدفعة'}</button>
    </form>
  );
}
