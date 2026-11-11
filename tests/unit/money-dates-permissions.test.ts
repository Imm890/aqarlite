import { describe, expect, it } from 'vitest';
import {
  addMonthsClamped,
  compareIsoDate,
  isValidIsoDate,
  parseIsoDate,
  todayInTimeZone,
} from '@/domain/dates';
import { formatCents, isFinalPriceWithinDiscount, minFinalPriceCents, parseMoneyToCents } from '@/domain/money';
import { PERMISSIONS, can, type Permission, type Role } from '@/domain/permissions';

describe('money', () => {
  it('parseMoneyToCents بدون float', () => {
    expect(parseMoneyToCents('1234.56')).toBe(123456);
    expect(parseMoneyToCents('1,234.5')).toBe(123450);
    expect(parseMoneyToCents('١٢٣٤٫٥٠')).toBe(123450);
    expect(parseMoneyToCents('0.10')).toBe(10);
    expect(parseMoneyToCents('0.29')).toBe(29); // 0.29*100 في float = 28.999…
    expect(parseMoneyToCents('19.99')).toBe(1999);
  });
  it('يرفض المدخلات الخاطئة', () => {
    for (const bad of ['', 'abc', '1.234', '-5', '1e3', '1.', '.5', '999999999999999']) {
      expect(parseMoneyToCents(bad)).toBeNull();
    }
  });
  it('formatCents', () => {
    expect(formatCents(0)).toBe('0.00');
    expect(formatCents(5)).toBe('0.05');
    expect(formatCents(123456789)).toBe('1,234,567.89');
  });
  it('حد الخصم 5% بحساب صحيح دقيق', () => {
    expect(isFinalPriceWithinDiscount(100_000_00, 95_000_00)).toBe(true); // 5% بالضبط
    expect(isFinalPriceWithinDiscount(100_000_00, 94_999_99)).toBe(false); // أكثر بهللة
    expect(isFinalPriceWithinDiscount(100_000_00, 100_000_00)).toBe(true);
    expect(isFinalPriceWithinDiscount(100_000_00, 100_000_01)).toBe(false); // أعلى من سعر الوحدة
    // 3,333,333 × 0.95 = 3,166,666.35 ⇒ الحد الأدنى 3,166,667 هللة
    expect(isFinalPriceWithinDiscount(33_333_33, 31_666_67)).toBe(true);
    expect(isFinalPriceWithinDiscount(33_333_33, 31_666_66)).toBe(false);
  });
});

describe('minFinalPriceCents', () => {
  it('يتطابق مع حد الخصم تماماً (أدنى سعر مقبول وما دونه بهللة مرفوض)', () => {
    for (const unit of [100_000_00, 33_333_33, 1, 19, 20, 21, 99_999_999_99, 7_77]) {
      const min = minFinalPriceCents(unit);
      expect(isFinalPriceWithinDiscount(unit, min)).toBe(true);
      if (min > 1) expect(isFinalPriceWithinDiscount(unit, min - 1)).toBe(false);
    }
    expect(minFinalPriceCents(100_000_00)).toBe(95_000_00);
  });
});

describe('dates', () => {
  it('صحة التواريخ', () => {
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('26-01-01')).toBe(false);
    expect(parseIsoDate('2026-04-31')).toBeNull();
  });
  it('addMonthsClamped يحسب من البداية الأصلية', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2026-01-31', 2)).toBe('2026-03-31');
    expect(addMonthsClamped('2026-01-31', 12)).toBe('2027-01-31');
    expect(addMonthsClamped('2026-12-31', 2)).toBe('2027-02-28');
    expect(addMonthsClamped('2026-05-15', 0)).toBe('2026-05-15');
    expect(addMonthsClamped('2026-05-15', 120)).toBe('2036-05-15');
  });
  it('compareIsoDate', () => {
    expect(compareIsoDate('2026-01-01', '2026-01-02')).toBe(-1);
    expect(compareIsoDate('2026-02-01', '2026-02-01')).toBe(0);
    expect(compareIsoDate('2027-01-01', '2026-12-31')).toBe(1);
  });
  it('todayInTimeZone يحترم المنطقة الزمنية', () => {
    const instant = new Date('2026-03-10T22:30:00Z');
    expect(todayInTimeZone('UTC', instant)).toBe('2026-03-10');
    expect(todayInTimeZone('Asia/Riyadh', instant)).toBe('2026-03-11'); // UTC+3
    expect(todayInTimeZone('America/Los_Angeles', instant)).toBe('2026-03-10');
  });
});

describe('permissions matrix', () => {
  const allowed = (role: Role): Permission[] =>
    (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p)).sort();

  it('مدير الشركة', () => {
    expect(allowed('company_admin')).toEqual(
      [
        'audit:read',
        'client:read_all',
        'contract:read_all',
        'reservation:read_all',
        'unit:create',
        'unit:read',
        'unit:update_price',
      ].sort(),
    );
  });
  it('المندوب لا يعتمد العقود ولا يسجّل الدفعات ولا يعدّل الأسعار', () => {
    expect(can('sales_rep', 'contract:approve')).toBe(false);
    expect(can('sales_rep', 'payment:create')).toBe(false);
    expect(can('sales_rep', 'unit:update_price')).toBe(false);
    expect(can('sales_rep', 'client:read_all')).toBe(false);
    expect(can('sales_rep', 'client:create')).toBe(true);
    expect(can('sales_rep', 'reservation:create')).toBe(true);
    expect(can('sales_rep', 'contract:create')).toBe(true);
  });
  it('المحاسب يعتمد ويسجّل الدفعات ولا يعدّل الوحدات ولا يقرأ سجل التدقيق', () => {
    expect(can('accountant', 'contract:approve')).toBe(true);
    expect(can('accountant', 'payment:create')).toBe(true);
    expect(can('accountant', 'contract:read_all')).toBe(true);
    expect(can('accountant', 'unit:update_price')).toBe(false);
    expect(can('accountant', 'unit:create')).toBe(false);
    expect(can('accountant', 'audit:read')).toBe(false);
  });
  it('لا أحد يستطيع الحجز غير المندوب، ولا تعديل سجل التدقيق (لا صلاحية كتابة أصلاً)', () => {
    expect(can('company_admin', 'reservation:create')).toBe(false);
    expect(can('accountant', 'reservation:create')).toBe(false);
    expect(Object.keys(PERMISSIONS).some((p) => p.startsWith('audit:') && p !== 'audit:read')).toBe(false);
  });
});
