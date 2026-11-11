'use client';

import Link from 'next/link';
import { ErrorAlert, Loading, Num } from '@/components/ui';
import { useApi } from '@/lib/client/api';
import { dateTime } from '@/lib/client/format';

interface ClientDto { id: string; name: string; phone: string; notes: string; ownerName: string; createdAt: string }

export function ClientDetail({ id }: { id: string }) {
  const { data, error, loading, reload } = useApi<ClientDto>(`/api/clients/${encodeURIComponent(id)}`);
  return (
    <>
      <div className="page-head"><h1>بيانات العميل</h1><Link href="/clients" className="btn secondary small">← العودة للقائمة</Link></div>
      {loading && !data && <Loading rows={3} />}
      {error && <ErrorAlert error={error.status === 404 ? 'العميل غير موجود.' : error} onRetry={error.status === 404 ? undefined : reload} />}
      {data && (
        <div className="card">
          <div className="grid">
            <div className="stat"><span>الاسم</span><b>{data.name}</b></div>
            <div className="stat"><span>الهاتف</span><b><Num>{data.phone}</Num></b></div>
            <div className="stat"><span>المندوب</span><b>{data.ownerName}</b></div>
            <div className="stat"><span>أُضيف</span><b>{dateTime(data.createdAt)}</b></div>
          </div>
          <h2>الملاحظات</h2>
          {/* نص حرفي: React يرمّز المحتوى فلا ينفَّذ أي وسم أو سكربت (لا dangerouslySetInnerHTML في المشروع) */}
          {data.notes ? <p className="notes">{data.notes}</p> : <p className="hint">لا توجد ملاحظات.</p>}
        </div>
      )}
    </>
  );
}
