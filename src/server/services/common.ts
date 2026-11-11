import { z } from 'zod';
import { isValidCents, MAX_AMOUNT_CENTS } from '@/domain/money';
import type { Db } from '@/lib/db';

/** معاملات الاستعلام تصل نصوصاً: نقبل أرقاماً صحيحة فقط ونرفض أي شيء آخر (1e3، -1، 1.5، فراغ…). */
const digits = (max: number): z.ZodString => z.string().regex(new RegExp(`^\\d{1,${max}}$`), 'قيمة رقمية غير صالحة.');

export const pageQuery = digits(6)
  .transform(Number)
  .refine((n) => n >= 1, 'رقم الصفحة يبدأ من 1.')
  .default(1);

export const pageSizeQuery = digits(3)
  .transform(Number)
  .refine((n) => n >= 1 && n <= 100, 'حجم الصفحة بين 1 و100.')
  .default(20);

export const centsQuery = digits(12)
  .transform(Number)
  .refine(isValidCents, 'مبلغ غير صالح.');

/** مبلغ في جسم JSON: عدد صحيح بالهللات (لا كسور عشرية أبداً). */
export const centsBody = z.number().int().min(0).max(MAX_AMOUNT_CENTS);
export const positiveCentsBody = z.number().int().min(1).max(MAX_AMOUNT_CENTS);

export const idParam = z.strictObject({ id: z.uuid() });

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** bigint من PostgreSQL يصل نصاً؛ نحوّله لعدد صحيح آمن أو نفشل بصوت عالٍ. */
export function toInt(value: string | number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError('integer out of safe range');
  return n;
}

/** يهرّب محارف LIKE الخاصة حتى لا يتحول إدخال المستخدم إلى نمط. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * يطبّق انتهاء صلاحية الحجوزات (72 ساعة) في قاعدة البيانات ضمن المعاملة الحالية،
 * فتكون حالات الوحدات والحجوزات صحيحة فور القراءة دون تدخل يدوي.
 */
export async function sweepExpiredReservations(db: Db): Promise<void> {
  await db.query('SELECT expire_stale_reservations()');
}
