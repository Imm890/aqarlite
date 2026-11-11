'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Badge, Empty, ErrorAlert, Loading, Modal, Num, Pager, SelectInput, TextInput } from '@/components/ui';
import { useSession } from '@/components/AppShell';
import { can } from '@/domain/permissions';
import { MAX_INSTALLMENTS } from '@/domain/installments';
import { formatCents, minFinalPriceCents, parseMoneyToCents } from '@/domain/money';
import { api, ApiError, useApi, type Page } from '@/lib/client/api';
import { dateTime, money, RESERVATION_STATUS_LABEL } from '@/lib/client/format';

interface Reservation {
  id: string; status: string; unitLabel: string; unitPriceCents: number; clientName: string; repName: string;
  reservedAt: string; expiresAt: string; contractId: string | null;
}

export function ReservationsView() {
  const session = useSession();
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);
  const [drafting, setDrafting] = useState<Reservation>();
  const params = new URLSearchParams({ page: String(page), pageSize: '10' });
  if (status) params.set('status', status);
  const { data, error, loading, reload } = useApi<Page<Reservation>>(`/api/reservations?${params.toString()}`);
  const canDraft = can(session.role, 'contract:create');

  return (
    <>
      <div className="page-head"><h1>الحجوزات</h1></div>
      <div className="card filters" role="search">
        <SelectInput label="الحالة" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">الكل</option><option value="active">نشطة</option><option value="expired">منتهية</option><option value="converted">تحوّلت لعقد</option>
        </SelectInput>
      </div>
      {error && <ErrorAlert error={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && data.items.length === 0 && <Empty title="لا توجد حجوزات" hint="احجز وحدة متاحة من صفحة «الوحدات»." />}
      {data && data.items.length > 0 && (
        <>
          <div className="card table-wrap">
            <table>
              <thead><tr><th>الوحدة</th><th>العميل</th><th>المندوب</th><th>الحالة</th><th>ينتهي</th><th><span className="sr-only">إجراءات</span></th></tr></thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id}>
                    <td data-label="الوحدة">{r.unitLabel}</td>
                    <td data-label="العميل">{r.clientName}</td>
                    <td data-label="المندوب">{r.repName}</td>
                    <td data-label="الحالة"><Badge kind={r.status}>{RESERVATION_STATUS_LABEL[r.status]}</Badge></td>
                    <td data-label="ينتهي">{dateTime(r.expiresAt)}</td>
                    <td className="actions">
                      {r.contractId && <Link className="btn small secondary" href={`/contracts/${r.contractId}`}>عرض العقد</Link>}
                      {canDraft && r.status === 'active' && !r.contractId && <button className="btn small" type="button" onClick={() => setDrafting(r)}>إنشاء عقد</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
      {drafting && <DraftModal reservation={drafting} currency={session.currency} onClose={() => { setDrafting(undefined); reload(); }} />}
    </>
  );
}

function DraftModal({ reservation, currency, onClose }: { reservation: Reservation; currency: string; onClose: () => void }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ finalPrice: formatCents(reservation.unitPriceCents).replace(/,/g, ''), down: '0', count: '12', startDate: today });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }): void => setF((p) => ({ ...p, [k]: e.target.value }));
  const minCents = minFinalPriceCents(reservation.unitPriceCents);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    const local: Record<string, string> = {};
    const finalCents = parseMoneyToCents(f.finalPrice);
    const downCents = parseMoneyToCents(f.down);
    const count = Number(f.count);
    if (finalCents === null || finalCents < 1) local['finalPriceCents'] = 'أدخل سعراً صحيحاً.';
    else if (finalCents > reservation.unitPriceCents || finalCents < minCents) local['finalPriceCents'] = `السعر بين ${formatCents(minCents)} و${formatCents(reservation.unitPriceCents)} (خصم أقصاه 5%).`;
    if (downCents === null) local['downPaymentCents'] = 'أدخل مبلغاً صحيحاً.';
    else if (finalCents !== null && downCents >= finalCents) local['downPaymentCents'] = 'الدفعة الأولى يجب أن تكون أقل من السعر النهائي.';
    if (!/^\d{1,3}$/.test(f.count) || count < 1 || count > MAX_INSTALLMENTS) local['installmentsCount'] = `عدد الأقساط بين 1 و${MAX_INSTALLMENTS}.`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.startDate)) local['startDate'] = 'تاريخ غير صالح.';
    setErrors(local);
    if (Object.keys(local).length > 0 || finalCents === null || downCents === null) return;
    setBusy(true);
    setError(undefined);
    try {
      const created = await api<{ id: string }>('/api/contracts', {
        method: 'POST',
        body: { reservationId: reservation.id, finalPriceCents: finalCents, downPaymentCents: downCents, installmentsCount: count, startDate: f.startDate },
      });
      router.push(`/contracts/${created.id}`);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : undefined;
      setError(apiErr);
      if (apiErr) setErrors(apiErr.fields);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="إنشاء مسودة عقد" onClose={onClose}>
      <p>{reservation.unitLabel} — {reservation.clientName}<br />سعر الوحدة: <Num>{money(reservation.unitPriceCents, currency)}</Num></p>
      {error && Object.keys(error.fields).length === 0 && <ErrorAlert error={error} />}
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <TextInput label="السعر النهائي" inputMode="decimal" dir="ltr" value={f.finalPrice} onChange={set('finalPrice')} error={errors['finalPriceCents']} hint="خصم أقصاه 5% من سعر الوحدة" />
          <TextInput label="الدفعة الأولى" inputMode="decimal" dir="ltr" value={f.down} onChange={set('down')} error={errors['downPaymentCents']} />
          <TextInput label="عدد الأقساط الشهرية" inputMode="numeric" dir="ltr" value={f.count} onChange={set('count')} error={errors['installmentsCount']} />
          <TextInput label="تاريخ بداية العقد" type="date" dir="ltr" value={f.startDate} onChange={set('startDate')} error={errors['startDate']} />
        </div>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'جارٍ الإنشاء…' : 'إنشاء المسودة'}</button>
      </form>
    </Modal>
  );
}
