'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge, Empty, ErrorAlert, Loading, Num, Pager, SelectInput } from '@/components/ui';
import { useSession } from '@/components/AppShell';
import { useApi, type Page } from '@/lib/client/api';
import { CONTRACT_STATUS_LABEL, dateTime, money } from '@/lib/client/format';

interface Row { id: string; status: string; unitLabel: string; clientName: string; repName: string; finalPriceCents: number; paidCents: number; remainingCents: number; createdAt: string }

export function ContractsView() {
  const session = useSession();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), pageSize: '10' });
  if (status) params.set('status', status);
  const { data, error, loading, reload } = useApi<Page<Row>>(`/api/contracts?${params.toString()}`);

  return (
    <>
      <div className="page-head"><h1>العقود</h1></div>
      <div className="card filters" role="search">
        <SelectInput label="الحالة" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">الكل</option><option value="draft">مسودة</option><option value="approved">معتمد</option><option value="cancelled">ملغى</option>
        </SelectInput>
      </div>
      {error && <ErrorAlert error={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && data.items.length === 0 && <Empty title="لا توجد عقود" hint="تُنشأ العقود من الحجوزات النشطة." />}
      {data && data.items.length > 0 && (
        <>
          <div className="card table-wrap">
            <table>
              <thead><tr><th>الوحدة</th><th>العميل</th><th>المندوب</th><th>الحالة</th><th>السعر النهائي</th><th>المتبقي</th><th>أُنشئ</th></tr></thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id}>
                    <td data-label="الوحدة"><Link href={`/contracts/${c.id}`}>{c.unitLabel}</Link></td>
                    <td data-label="العميل">{c.clientName}</td>
                    <td data-label="المندوب">{c.repName}</td>
                    <td data-label="الحالة"><Badge kind={c.status}>{CONTRACT_STATUS_LABEL[c.status]}</Badge></td>
                    <td data-label="السعر النهائي"><Num>{money(c.finalPriceCents, session.currency)}</Num></td>
                    <td data-label="المتبقي"><Num>{c.status === 'approved' ? money(c.remainingCents, session.currency) : '—'}</Num></td>
                    <td data-label="أُنشئ">{dateTime(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </>
  );
}
