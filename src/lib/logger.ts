/**
 * سجلات الخادم (JSON سطراً سطراً). التفاصيل التقنية للأخطاء تذهب إلى هنا فقط،
 * أما المستخدم فيرى رسالة عامة ورقم الطلب (requestId) للمطابقة.
 * أي مفتاح اسمه يشير إلى سر يُحجب تلقائياً.
 */
const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|cookie|hash|api[-_]?key/i;
const MAX_DEPTH = 5;

function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[truncated]';
  if (value instanceof Error) return serializeError(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function serializeError(error: Error): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const key of ['code', 'detail', 'constraint', 'table', 'column', 'severity']) {
    const v = (error as unknown as Record<string, unknown>)[key];
    if (v !== undefined) extra[key] = v;
  }
  return { name: error.name, message: error.message, stack: error.stack, ...extra };
}

type Level = 'info' | 'warn' | 'error';

function write(level: Level, message: string, fields?: Record<string, unknown>): void {
  if (process.env['VITEST'] && !process.env['LOG_IN_TESTS']) return;
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.warn(line); // stderr: لا نضيف console.log (يُمنع بقاعدة ESLint)
}

export const logger = {
  info: (message: string, fields?: Record<string, unknown>): void => write('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>): void => write('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>): void => write('error', message, fields),
};
