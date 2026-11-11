'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Empty, ErrorAlert, Loading, Modal, Num, Pager, TextArea, TextInput } from '@/components/ui';
import { useSession } from '@/components/AppShell';
import { can } from '@/domain/permissions';
import { api, ApiError, useApi, type Page } from '@/lib/client/api';
import { dateTime } from '@/lib/client/format';

interface ClientRow { id: string; name: string; phone: string; ownerName: string; createdAt: string }

export function ClientsView() {
  const session = useSession();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string>();
  const params = new URLSearchParams({ page: String(page), pageSize: '10' });
  if (q.trim()) params.set('q', q.trim());
  const { data, error, loading, reload } = useApi<Page<ClientRow>>(`/api/clients?${params.toString()}`);
  const showOwner = can(session.role, 'client:read_all');

  return (
    <>
      <div className="page-head">
        <h1>{showOwner ? 'عملاء الشركة' : 'عملائي'}</h1>
        {can(session.role, 'client:create') && <button className="btn" type="button" onClick={() => setAdding(true)}>+ إضافة عميل</button>}
      </div>
      {notice && <div className="alert ok" role="status">{notice}</div>}
      <div className="card filters" role="search">
        <TextInput label="بحث بالاسم أو الهاتف" value={q} maxLength={60} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      </div>
      {error && <ErrorAlert error={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && data.items.length === 0 && <Empty title="لا يوجد عملاء" hint={q ? 'لا نتائج مطابقة للبحث.' : 'ابدأ بإضافة أول عميل.'} />}
      {data && data.items.length > 0 && (
        <>
          <div className="card table-wrap">
            <table>
              <thead><tr><th>الاسم</th><th>الهاتف</th>{showOwner && <th>المندوب</th>}<th>أُضيف</th></tr></thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id}>
                    <td data-label="الاسم"><Link href={`/clients/${c.id}`}>{c.name}</Link></td>
                    <td data-label="الهاتف"><Num>{c.phone}</Num></td>
                    {showOwner && <td data-label="المندوب">{c.ownerName}</td>}
                    <td data-label="أُضيف">{dateTime(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
      {adding && <AddClient onClose={() => setAdding(false)} onDone={() => { setAdding(false); setNotice('تمت إضافة العميل.'); reload(); }} />}
    </>
  );
}

function AddClient({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api('/api/clients', { method: 'POST', body: { name, phone, notes } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err : undefined);
    } finally {
      setBusy(false);
    }
  }
  const f = error?.fields ?? {};
  return (
    <Modal title="إضافة عميل" onClose={onClose}>
      {error && Object.keys(f).length === 0 && <ErrorAlert error={error} />}
      <form onSubmit={submit} noValidate>
        <TextInput label="الاسم" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} error={f['name']} />
        <TextInput label="الهاتف" dir="ltr" inputMode="tel" value={phone} placeholder="+966551234567" onChange={(e) => setPhone(e.target.value)} error={f['phone']} />
        <TextArea label="ملاحظات (اختياري)" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} error={f['notes']} />
        <button className="btn" type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'إضافة'}</button>
      </form>
    </Modal>
  );
}
