'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** خطأ من الـ API: الرسالة عربية عامة، و fields تحمل رسائل التحقق لكل حقل. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string; fields?: Record<string, string> };
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'تعذّر الاتصال بالخادم. تحقق من الشبكة وأعد المحاولة.');
  }
  const data = (await response.json().catch(() => ({}))) as T & ErrorBody;
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/api/auth/login')) {
      window.location.assign('/login'); // انتهت الجلسة
    }
    const e = data.error;
    throw new ApiError(response.status, e?.code ?? 'ERROR', e?.message ?? 'حدث خطأ غير متوقع.', e?.fields ?? {});
  }
  return data;
}

export interface ApiState<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  reload: () => void;
}

/** جلب بيانات مع حالات التحميل والخطأ. الطلبات المتأخرة القديمة تُتجاهل. */
export function useApi<T>(path: string | null): ApiState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError>();
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    if (path === null) return;
    const id = (latest.current += 1);
    setLoading(true);
    api<T>(path)
      .then((d) => {
        if (id !== latest.current) return;
        setData(d);
        setError(undefined);
      })
      .catch((e: unknown) => {
        if (id !== latest.current) return;
        setError(e instanceof ApiError ? e : new ApiError(0, 'ERROR', 'حدث خطأ غير متوقع.'));
      })
      .finally(() => {
        if (id === latest.current) setLoading(false);
      });
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
