'use client';

import { useState, type FormEvent } from 'react';
import { Badge, Empty, ErrorAlert, Loading, Modal, Num, Pager, SelectInput, TextInput } from '@/components/ui';
import { useSession } from '@/components/AppShell';
import { can } from '@/domain/permissions';
import { formatCents, parseMoneyToCents } from '@/domain/money';
import { api, ApiError, useApi, type Page } from '@/lib/client/api';
import { money, UNIT_STATUS_LABEL, UNIT_TYPE_LABEL } from '@/lib/client/format';

interface Unit { id: string; project: string; number: string; type: string; areaSqm: number; rooms: number; priceCents: number; status: string }
interface ClientLite { id: string; name: string; phone: string }

const PAGE_SIZE = 10;

export function UnitsView() {
  const session = useSession();
  const [status, setStatus] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [sort, setSort] = useState('price');
  const [order, setOrder] = useState('asc');
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<string>();
  const [reserving, setReserving] = useState<Unit>();
  const [pricing, setPricing] = useState<Unit>();
  const [adding, setAdding] = useState(false);

  const minCents = min.trim() === '' ? undefined : parseMoneyToCents(min);
  const maxCents = max.trim() === '' ? undefined : parseMoneyToCents(max);
  const filterError = minCents === null || maxCents === null ? 'أدخل مبلغاً صحيحاً (بحد أقصى خانتين عشريتين).' : undefined;

  const params = new URLSearchParams({ sort, order, page: String(page), pageSize: String(PAGE_SIZE) });
  if (status) params.set('status', status);
  if (typeof minCents === 'number') params.set('minPriceCents', String(minCents));
  if (typeof maxCents === 'number') params.set('maxPriceCents', String(maxCents));
  const { data, error, loading, reload } = useApi<Page<Unit>>(filterError ? null : `/api/units?${params.toString()}`);

  const canReserve = can(session.role, 'reservation:create');
  const canAdd = can(session.role, 'unit:create');
  const canPrice = can(session.role, 'unit:update_price');
  const reset = (fn: () => void) => () => { fn(); setPage(1); };

  return (
    <>
      <div className="page-head">
        <h1>الوحدات</h1>
        {canAdd && <button className="btn" type="button" onClick={() => setAdding(true)}>+ إضافة وحدة</button>}
      </div>
      {notice && <div className="alert ok" role="status">{notice}</div>}

      <div className="card filters" role="search" aria-label="تصفية الوحدات">
        <SelectInput label="الحالة" value={status} onChange={(e) => reset(() => setStatus(e.target.value))()}>
          <option value="">الكل</option>
          <option value="available">متاحة</option><option value="reserved">محجوزة</option><option value="sold">مُباعة</option>
        </SelectInput>
        <TextInput label="السعر من" inputMode="decimal" dir="ltr" value={min} placeholder="0.00" error={filterError && minCents === null ? filterError : undefined}
          onChange={(e) => reset(() => setMin(e.target.value))()} />
        <TextInput label="السعر إلى" inputMode="decimal" dir="ltr" value={max} placeholder="0.00" error={filterError && maxCents === null ? filterError : undefined}
          onChange={(e) => reset(() => setMax(e.target.value))()} />
        <SelectInput label="ترتيب حسب" value={sort} onChange={(e) => reset(() => setSort(e.target.value))()}>
          <option value="price">السعر</option><option value="area">المساحة</option>
        </SelectInput>
        <SelectInput label="الاتجاه" value={order} onChange={(e) => reset(() => setOrder(e.target.value))()}>
          <option value="asc">تصاعدي</option><option value="desc">تنازلي</option>
        </SelectInput>
      </div>

      {error && <ErrorAlert error={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && data.items.length === 0 && <Empty title="لا توجد وحدات مطابقة" hint="غيّر عوامل التصفية أو أضف وحدة جديدة." />}
      {data && data.items.length > 0 && (
        <>
          <div className="card table-wrap" aria-busy={loading}>
            <table>
              <thead><tr><th>المشروع</th><th>الرقم</th><th>النوع</th><th>المساحة (م²)</th><th>الغرف</th><th>السعر</th><th>الحالة</th><th><span className="sr-only">إجراءات</span></th></tr></thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id}>
                    <td data-label="المشروع">{u.project}</td>
                    <td data-label="الرقم"><Num>{u.number}</Num></td>
                    <td data-label="النوع">{UNIT_TYPE_LABEL[u.type] ?? u.type}</td>
                    <td data-label="المساحة (م²)"><Num>{u.areaSqm}</Num></td>
                    <td data-label="الغرف"><Num>{u.rooms}</Num></td>
                    <td data-label="السعر"><Num>{money(u.priceCents, session.currency)}</Num></td>
                    <td data-label="الحالة"><Badge kind={u.status}>{UNIT_STATUS_LABEL[u.status]}</Badge></td>
                    <td className="actions">
                      {canReserve && u.status === 'available' && <button className="btn small" type="button" onClick={() => setReserving(u)}>حجز 72 ساعة</button>}
                      {canPrice && u.status === 'available' && <button className="btn small secondary" type="button" onClick={() => setPricing(u)}>تعديل السعر</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}

      {reserving && <ReserveModal unit={reserving} currency={session.currency} onClose={() => setReserving(undefined)}
        onDone={(m) => { setReserving(undefined); setNotice(m); reload(); }} />}
      {pricing && <PriceModal unit={pricing} onClose={() => setPricing(undefined)}
        onDone={(m) => { setPricing(undefined); setNotice(m); reload(); }} />}
      {adding && <AddUnitModal onClose={() => setAdding(false)} onDone={(m) => { setAdding(false); setNotice(m); reload(); }} />}
    </>
  );
}

function ReserveModal({ unit, currency, onClose, onDone }: { unit: Unit; currency: string; onClose: () => void; onDone: (m: string) => void }) {
  const clients = useApi<Page<ClientLite>>('/api/clients?pageSize=100');
  const [clientId, setClientId] = useState('');
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api('/api/reservations', { method: 'POST', body: { unitId: unit.id, clientId } });
      onDone(`تم حجز الوحدة ${unit.number} لمدة 72 ساعة.`);
    } catch (err) {
      setError(err instanceof ApiError ? err : undefined);
      // الوحدة قد تكون حُجزت من مندوب آخر: نحدّث القائمة ونُبقي الرسالة الواضحة ظاهرة
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`حجز الوحدة ${unit.number}`} onClose={onClose}>
      <p>{unit.project} — <Num>{money(unit.priceCents, currency)}</Num></p>
      {error && <ErrorAlert error={error} />}
      {clients.loading && <Loading rows={1} />}
      {clients.error && <ErrorAlert error={clients.error} onRetry={clients.reload} />}
      {clients.data && clients.data.items.length === 0 && (
        <div className="alert warn">لا يوجد لديك عملاء بعد. أضف عميلاً من صفحة «العملاء» أولاً.</div>
      )}
      {clients.data && clients.data.items.length > 0 && (
        <form onSubmit={submit}>
          <SelectInput label="العميل" required value={clientId} onChange={(e) => setClientId(e.target.value)} error={error?.fields['clientId']}>
            <option value="">اختر العميل…</option>
            {clients.data.items.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>)}
          </SelectInput>
          <p className="hint">تعود الوحدة متاحة تلقائياً إذا لم يُنشأ عقد خلال 72 ساعة.</p>
          <button className="btn" type="submit" disabled={busy || !clientId}>{busy ? 'جارٍ الحجز…' : 'تأكيد الحجز'}</button>
        </form>
      )}
    </Modal>
  );
}

function PriceModal({ unit, onClose, onDone }: { unit: Unit; onClose: () => void; onDone: (m: string) => void }) {
  const [price, setPrice] = useState(formatCents(unit.priceCents).replace(/,/g, ''));
  const [error, setError] = useState<ApiError>();
  const [local, setLocal] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    const cents = parseMoneyToCents(price);
    if (cents === null || cents < 1) { setLocal('أدخل مبلغاً صحيحاً أكبر من صفر.'); return; }
    setLocal(undefined);
    setBusy(true);
    setError(undefined);
    try {
      await api(`/api/units/${unit.id}/price`, { method: 'PATCH', body: { priceCents: cents } });
      onDone(`تم تحديث سعر الوحدة ${unit.number} (وسُجّل التغيير في سجل التدقيق).`);
    } catch (err) {
      setError(err instanceof ApiError ? err : undefined);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`تعديل سعر الوحدة ${unit.number}`} onClose={onClose}>
      {error && <ErrorAlert error={error} />}
      <form onSubmit={submit} noValidate>
        <TextInput label="السعر الجديد" inputMode="decimal" dir="ltr" value={price} onChange={(e) => setPrice(e.target.value)}
          error={local ?? error?.fields['priceCents']} hint="لا يمكن تعديل سعر وحدة محجوزة أو مُباعة." />
        <button className="btn" type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>
      </form>
    </Modal>
  );
}

function AddUnitModal({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const [f, setF] = useState({ project: '', number: '', type: 'apartment', areaSqm: '', rooms: '', price: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }): void => setF((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    const local: Record<string, string> = {};
    const cents = parseMoneyToCents(f.price);
    if (cents === null || cents < 1) local['priceCents'] = 'أدخل سعراً صحيحاً.';
    const area = Number(f.areaSqm);
    if (!/^\d+(\.\d{1,2})?$/.test(f.areaSqm) || area <= 0) local['areaSqm'] = 'أدخل مساحة صحيحة (حتى خانتين عشريتين).';
    if (!/^\d{1,2}$/.test(f.rooms)) local['rooms'] = 'أدخل عدد الغرف.';
    if (!f.project.trim()) local['project'] = 'اسم المشروع مطلوب.';
    if (!f.number.trim()) local['number'] = 'رقم الوحدة مطلوب.';
    setErrors(local);
    if (Object.keys(local).length > 0 || cents === null) return;
    setBusy(true);
    setError(undefined);
    try {
      await api('/api/units', { method: 'POST', body: { project: f.project.trim(), number: f.number.trim(), type: f.type, areaSqm: area, rooms: Number(f.rooms), priceCents: cents } });
      onDone('تمت إضافة الوحدة.');
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : undefined;
      setError(apiErr);
      if (apiErr) setErrors(apiErr.fields);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="إضافة وحدة" onClose={onClose}>
      {error && Object.keys(error.fields).length === 0 && <ErrorAlert error={error} />}
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <TextInput label="المشروع" value={f.project} onChange={set('project')} error={errors['project']} />
          <TextInput label="رقم الوحدة" dir="ltr" value={f.number} onChange={set('number')} error={errors['number']} />
          <SelectInput label="النوع" value={f.type} onChange={set('type')} error={errors['type']}>
            {Object.entries(UNIT_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </SelectInput>
          <TextInput label="المساحة (م²)" inputMode="decimal" dir="ltr" value={f.areaSqm} onChange={set('areaSqm')} error={errors['areaSqm']} />
          <TextInput label="عدد الغرف" inputMode="numeric" dir="ltr" value={f.rooms} onChange={set('rooms')} error={errors['rooms']} />
          <TextInput label="السعر" inputMode="decimal" dir="ltr" value={f.price} onChange={set('price')} error={errors['priceCents']} />
        </div>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'إضافة'}</button>
      </form>
    </Modal>
  );
}
