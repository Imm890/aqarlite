'use client';

import { useState } from 'react';
import { Empty, ErrorAlert, Loading, Num, Pager, SelectInput } from '@/components/ui';
import { useApi, type Page } from '@/lib/client/api';
import { AUDIT_ACTION_LABEL, dateTime } from '@/lib/client/format';

interface Row { id: number; action: string; actorName: string | null; entityType: string | null; details: Record<string, unknown>; ip: string | null; createdAt: string }

export function AuditView() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (action) params.set('action', action);
  const { data, error, loading, reload } = useApi<Page<Row>>(`/api/audit-logs?${params.toString()}`);

  return (
    <>
      <div className="page-head"><h1>سجل التدقيق</h1></div>
      <p className="hint">للقراءة فقط: لا يمكن لأي مستخدم تعديل هذا السجل أو حذفه.</p>
      <div className="card filters" role="search">
        <SelectInput label="نوع الحدث" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
          <option value="">الكل</option>
          {Object.entries(AUDIT_ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </SelectInput>
      </div>
      {error && <ErrorAlert error={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && data.items.length === 0 && <Empty title="لا توجد أحداث" />}
      {data && data.items.length > 0 && (
        <>
          <div className="card table-wrap">
            <table>
              <thead><tr><th>الوقت</th><th>الحدث</th><th>المنفّذ</th><th>التفاصيل</th><th>IP</th></tr></thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id}>
                    <td data-label="الوقت">{dateTime(r.createdAt)}</td>
                    <td data-label="الحدث">{AUDIT_ACTION_LABEL[r.action] ?? r.action}</td>
                    <td data-label="المنفّذ">{r.actorName ?? '—'}</td>
                    <td data-label="التفاصيل"><Num>{Object.keys(r.details).length ? JSON.stringify(r.details) : '—'}</Num></td>
                    <td data-label="IP"><Num>{r.ip ?? '—'}</Num></td>
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
