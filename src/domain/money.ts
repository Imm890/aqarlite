/**
 * المبالغ المالية تُمثَّل دائماً كأعداد صحيحة بوحدة أصغر عملة (هللة/فلس/سنت) — "cents".
 * لا يُستخدم float في أي مكان: لا في قاعدة البيانات (BIGINT) ولا في الكود ولا في JSON.
 * الحد الأقصى يضمن أن كل عمليات الضرب الوسيطة (×10000) تبقى ضمن Number.MAX_SAFE_INTEGER.
 */
export const MAX_AMOUNT_CENTS = 100_000_000_000; // مليار وحدة عملة

export function isValidCents(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_AMOUNT_CENTS
  );
}

export function assertCents(value: number, label = 'amount'): number {
  if (!isValidCents(value)) {
    throw new RangeError(`${label} must be a non-negative safe integer within limits`);
  }
  return value;
}

export function sumCents(values: readonly number[]): number {
  let total = 0;
  for (const v of values) {
    total += v;
    if (!Number.isSafeInteger(total)) throw new RangeError('sum overflow');
  }
  return total;
}

const EASTERN_ARABIC = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

/** يحوّل الأرقام العربية-الهندية/الفارسية إلى لاتينية. */
export function normalizeDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const a = EASTERN_ARABIC.indexOf(ch);
    if (a >= 0) {
      out += String(a);
      continue;
    }
    const p = PERSIAN.indexOf(ch);
    out += p >= 0 ? String(p) : ch;
  }
  return out;
}

/**
 * يحوّل نصاً مثل "1,234.5" أو "١٢٣٤٫٥٠" إلى هللات (123450) بحساب نصّي بحت دون float.
 * يرجع null إذا كان النص غير صالح (أكثر من خانتين عشريتين، رموز غريبة، تجاوز الحد…).
 */
export function parseMoneyToCents(input: string): number | null {
  const normalized = normalizeDigits(input)
    .trim()
    .replace(/[,\s٬]/g, '')
    .replace('٫', '.');
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(normalized)) return null;
  const [whole = '', fraction = ''] = normalized.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return isValidCents(cents) ? cents : null;
}

/** تنسيق للعرض "1,234.50" بحساب صحيح فقط. */
export function formatCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100);
  const fraction = String(abs % 100).padStart(2, '0');
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${fraction}`;
}

/** هل السعر النهائي ضمن [سعر الوحدة × (1 - الحد الأقصى للخصم)، سعر الوحدة]؟ حساب صحيح دقيق. */
export function isFinalPriceWithinDiscount(
  unitPriceCents: number,
  finalPriceCents: number,
  maxDiscountBasisPoints = 500,
): boolean {
  if (finalPriceCents > unitPriceCents) return false;
  return finalPriceCents * 10_000 >= unitPriceCents * (10_000 - maxDiscountBasisPoints);
}
