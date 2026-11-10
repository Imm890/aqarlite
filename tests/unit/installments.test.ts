import { describe, expect, it } from 'vitest';
import { generateSchedule } from '@/domain/installments';
import { sumCents } from '@/domain/money';
import { AppError } from '@/lib/errors';

const base = {
  finalPriceCents: 100_000_00,
  downPaymentCents: 10_000_00,
  installmentsCount: 9,
  startDate: '2026-03-15',
};

describe('generateSchedule', () => {
  it('المجموع (الدفعة الأولى + الأقساط) يساوي السعر النهائي تماماً', () => {
    const s = generateSchedule(base);
    expect(sumCents(s.map((i) => i.amountCents))).toBe(base.finalPriceCents);
  });

  it('الدفعة الأولى هي البند 0 وتستحق في تاريخ البداية', () => {
    const [first, second] = generateSchedule(base);
    expect(first).toMatchObject({ sequence: 0, kind: 'down_payment', dueDate: '2026-03-15', amountCents: 10_000_00 });
    expect(second).toMatchObject({ sequence: 1, kind: 'regular', dueDate: '2026-04-15' });
  });

  it('بدون دفعة أولى لا يُنشأ بند 0', () => {
    const s = generateSchedule({ ...base, downPaymentCents: 0 });
    expect(s).toHaveLength(9);
    expect(s[0]?.sequence).toBe(1);
    expect(sumCents(s.map((i) => i.amountCents))).toBe(base.finalPriceCents);
  });

  it('الباقي من القسمة يُوزَّع هللة هللة على أول الأقساط (فرق ≤ هللة)', () => {
    // المتبقي 100.00 ÷ 3 = 33.33 + باقي 1 هللة
    const s = generateSchedule({
      finalPriceCents: 100_00,
      downPaymentCents: 0,
      installmentsCount: 3,
      startDate: '2026-01-10',
    });
    expect(s.map((i) => i.amountCents)).toEqual([33_34, 33_33, 33_33]);
    expect(sumCents(s.map((i) => i.amountCents))).toBe(100_00);
  });

  it('قيم متطرفة: هللة واحدة لكل قسط', () => {
    const s = generateSchedule({
      finalPriceCents: 7,
      downPaymentCents: 0,
      installmentsCount: 7,
      startDate: '2026-01-10',
    });
    expect(s.map((i) => i.amountCents)).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });

  it('خاصية: لأي مدخلات عشوائية المجموع دقيق وكل قسط موجب والفرق ≤ هللة', () => {
    let seed = 42;
    const rnd = (max: number): number => {
      seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return seed % max;
    };
    for (let n = 0; n < 500; n += 1) {
      const finalPriceCents = 1_000 + rnd(9_000_000_000);
      const downPaymentCents = rnd(finalPriceCents - 200);
      const installmentsCount = 1 + rnd(120);
      const remaining = finalPriceCents - downPaymentCents;
      if (remaining < installmentsCount) continue;
      const s = generateSchedule({ finalPriceCents, downPaymentCents, installmentsCount, startDate: '2026-01-31' });
      expect(sumCents(s.map((i) => i.amountCents))).toBe(finalPriceCents);
      const regular = s.filter((i) => i.kind === 'regular').map((i) => i.amountCents);
      expect(regular).toHaveLength(installmentsCount);
      expect(Math.min(...regular)).toBeGreaterThan(0);
      expect(Math.max(...regular) - Math.min(...regular)).toBeLessThanOrEqual(1);
    }
  });

  describe('التواريخ الفردية (31 يناير)', () => {
    const s = generateSchedule({
      finalPriceCents: 1_200_00,
      downPaymentCents: 0,
      installmentsCount: 5,
      startDate: '2026-01-31',
    });
    const dates = s.map((i) => i.dueDate);

    it('القسط الأول في فبراير على آخر يوم (28 في سنة غير كبيسة)', () => {
      expect(dates[0]).toBe('2026-02-28');
    });
    it('لا انجراف: مارس يعود إلى 31 وليس 28', () => {
      expect(dates).toEqual(['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']);
    });
    it('سنة كبيسة: 31 يناير 2028 → 29 فبراير 2028', () => {
      const leap = generateSchedule({
        finalPriceCents: 100_00,
        downPaymentCents: 0,
        installmentsCount: 2,
        startDate: '2028-01-31',
      });
      expect(leap.map((i) => i.dueDate)).toEqual(['2028-02-29', '2028-03-31']);
    });
    it('عبور نهاية السنة: 30 نوفمبر → 30 ديسمبر → 30 يناير → 28 فبراير', () => {
      const y = generateSchedule({
        finalPriceCents: 100_00,
        downPaymentCents: 0,
        installmentsCount: 3,
        startDate: '2026-11-30',
      });
      expect(y.map((i) => i.dueDate)).toEqual(['2026-12-30', '2027-01-30', '2027-02-28']);
    });
    it('29 فبراير 2028 كبداية → فبراير 2029 على 28', () => {
      const y = generateSchedule({
        finalPriceCents: 1200_00,
        downPaymentCents: 0,
        installmentsCount: 12,
        startDate: '2028-02-29',
      });
      expect(y[11]?.dueDate).toBe('2029-02-28');
      expect(y[0]?.dueDate).toBe('2028-03-29');
    });
  });

  describe('التحقق من المدخلات', () => {
    const expectValidation = (fn: () => unknown, field: string): void => {
      try {
        fn();
        expect.unreachable('should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).code).toBe('VALIDATION');
        expect((e as AppError).fields).toHaveProperty(field);
      }
    };
    it('الدفعة الأولى ≥ السعر النهائي مرفوضة', () =>
      expectValidation(() => generateSchedule({ ...base, downPaymentCents: base.finalPriceCents }), 'downPaymentCents'));
    it('عدد أقساط صفر أو كسري أو أكبر من 120 مرفوض', () => {
      expectValidation(() => generateSchedule({ ...base, installmentsCount: 0 }), 'installmentsCount');
      expectValidation(() => generateSchedule({ ...base, installmentsCount: 2.5 }), 'installmentsCount');
      expectValidation(() => generateSchedule({ ...base, installmentsCount: 121 }), 'installmentsCount');
    });
    it('تاريخ غير حقيقي (30 فبراير) مرفوض', () =>
      expectValidation(() => generateSchedule({ ...base, startDate: '2026-02-30' }), 'startDate'));
    it('أقساط أكثر من المتبقي بالهللات مرفوضة', () =>
      expectValidation(
        () => generateSchedule({ finalPriceCents: 10, downPaymentCents: 0, installmentsCount: 11, startDate: '2026-01-01' }),
        'installmentsCount',
      ));
  });
});
