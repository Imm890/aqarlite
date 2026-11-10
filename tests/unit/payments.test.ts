import { describe, expect, it } from 'vitest';
import {
  allocatePayment,
  displayStatus,
  remainingBalance,
  storedStatus,
  type InstallmentState,
} from '@/domain/payments';
import { AppError } from '@/lib/errors';

const inst = (id: string, sequence: number, dueDate: string, amountCents: number, paidCents = 0): InstallmentState => ({
  id,
  sequence,
  dueDate,
  amountCents,
  paidCents,
});

const schedule = (): InstallmentState[] => [
  inst('a', 0, '2026-01-01', 1000_00),
  inst('b', 1, '2026-02-01', 500_00),
  inst('c', 2, '2026-03-01', 500_00),
];

describe('allocatePayment', () => {
  it('يغطي أقدم قسط أولاً ثم ينتقل للتالي', () => {
    const r = allocatePayment(schedule(), 1200_00);
    expect(r).toEqual([
      { installmentId: 'a', amountCents: 1000_00, newPaidCents: 1000_00, newStatus: 'paid' },
      { installmentId: 'b', amountCents: 200_00, newPaidCents: 200_00, newStatus: 'partial' },
    ]);
  });

  it('دفعة أصغر من القسط تجعله partial', () => {
    const r = allocatePayment(schedule(), 1_00);
    expect(r).toEqual([{ installmentId: 'a', amountCents: 1_00, newPaidCents: 1_00, newStatus: 'partial' }]);
  });

  it('تكمل القسط الجزئي ثم تنتقل للتالي', () => {
    const s = schedule();
    s[0] = inst('a', 0, '2026-01-01', 1000_00, 900_00);
    const r = allocatePayment(s, 150_00);
    expect(r).toEqual([
      { installmentId: 'a', amountCents: 100_00, newPaidCents: 1000_00, newStatus: 'paid' },
      { installmentId: 'b', amountCents: 50_00, newPaidCents: 50_00, newStatus: 'partial' },
    ]);
  });

  it('تتخطى الأقساط المسددة بالكامل', () => {
    const s = schedule();
    s[0] = inst('a', 0, '2026-01-01', 1000_00, 1000_00);
    const r = allocatePayment(s, 500_00);
    expect(r).toEqual([{ installmentId: 'b', amountCents: 500_00, newPaidCents: 500_00, newStatus: 'paid' }]);
  });

  it('الترتيب بتاريخ الاستحقاق لا بترتيب المصفوفة', () => {
    const shuffled = [schedule()[2], schedule()[0], schedule()[1]] as InstallmentState[];
    const r = allocatePayment(shuffled, 1000_00);
    expect(r.map((x) => x.installmentId)).toEqual(['a']);
  });

  it('تسديد كامل المتبقي بدفعة واحدة', () => {
    const r = allocatePayment(schedule(), 2000_00);
    expect(r.every((x) => x.newStatus === 'paid')).toBe(true);
    expect(r.reduce((t, x) => t + x.amountCents, 0)).toBe(2000_00);
  });

  it('ترفض دفعة تتجاوز المتبقي (حتى بهللة واحدة)', () => {
    try {
      allocatePayment(schedule(), 2000_01);
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('PAYMENT_EXCEEDS_BALANCE');
    }
  });

  it('ترفض الصفر والسالب والكسري وNaN', () => {
    for (const bad of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => allocatePayment(schedule(), bad)).toThrow(AppError);
    }
  });

  it('لا تعدّل المدخلات', () => {
    const s = schedule();
    const snapshot = JSON.parse(JSON.stringify(s)) as InstallmentState[];
    allocatePayment(s, 1200_00);
    expect(s).toEqual(snapshot);
  });

  it('خاصية: مجموع التوزيع = المبلغ والمتبقي ينقص بالمبلغ تماماً', () => {
    let seed = 7;
    const rnd = (max: number): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % max;
    };
    for (let n = 0; n < 300; n += 1) {
      const s = Array.from({ length: 1 + rnd(12) }, (_, i) =>
        inst(`i${i}`, i, `2026-${String(1 + (i % 12)).padStart(2, '0')}-10`, 100 + rnd(500_000)),
      );
      const total = remainingBalance(s);
      const amount = 1 + rnd(total);
      const alloc = allocatePayment(s, amount);
      expect(alloc.reduce((t, x) => t + x.amountCents, 0)).toBe(amount);
      for (const a of alloc) {
        const orig = s.find((x) => x.id === a.installmentId);
        expect(a.newPaidCents).toBeLessThanOrEqual(orig?.amountCents ?? 0);
      }
    }
  });
});

describe('الحالات', () => {
  it('storedStatus', () => {
    expect(storedStatus({ amountCents: 100, paidCents: 0 })).toBe('pending');
    expect(storedStatus({ amountCents: 100, paidCents: 40 })).toBe('partial');
    expect(storedStatus({ amountCents: 100, paidCents: 100 })).toBe('paid');
  });

  it('overdue بعد تاريخ الاستحقاق فقط وإن لم يُسدَّد', () => {
    const i = { amountCents: 100, paidCents: 0, dueDate: '2026-05-10' };
    expect(displayStatus(i, '2026-05-10')).toBe('pending'); // يوم الاستحقاق ليس تأخراً
    expect(displayStatus(i, '2026-05-11')).toBe('overdue');
    expect(displayStatus({ ...i, paidCents: 50 }, '2026-05-11')).toBe('overdue');
    expect(displayStatus({ ...i, paidCents: 100 }, '2026-05-11')).toBe('paid');
  });
});
