import { Errors } from '@/lib/errors';
import { addMonthsClamped, isValidIsoDate, type IsoDate } from './dates';
import { assertCents, sumCents } from './money';

export const MAX_INSTALLMENTS = 120;

export type InstallmentKind = 'down_payment' | 'regular';

export interface ScheduleInput {
  finalPriceCents: number;
  /** الدفعة الأولى (قد تكون 0). تُسجَّل كأول بند في الجدول (sequence = 0) إن كانت > 0. */
  downPaymentCents: number;
  installmentsCount: number;
  /** تاريخ بداية العقد: استحقاق الدفعة الأولى، والقسط k يستحق بعد k شهراً منه. */
  startDate: IsoDate;
}

export interface ScheduledInstallment {
  sequence: number;
  kind: InstallmentKind;
  dueDate: IsoDate;
  amountCents: number;
}

/**
 * يولّد جدول الأقساط.
 *
 * - المتبقي بعد الدفعة الأولى R = السعر النهائي − الدفعة الأولى.
 * - القسط الأساسي = floor(R / N) والباقي r = R mod N يُوزَّع هللة واحدة على أول r أقساط،
 *   فيكون الفرق بين أي قسطين ≤ هللة واحدة، ومجموع الأقساط + الدفعة الأولى = السعر النهائي تماماً.
 * - تواريخ الاستحقاق تُحسب من تاريخ البداية الأصلي مع تثبيت اليوم (انظر addMonthsClamped).
 */
export function generateSchedule(input: ScheduleInput): ScheduledInstallment[] {
  const { finalPriceCents, downPaymentCents, installmentsCount, startDate } = input;

  assertCents(finalPriceCents, 'finalPriceCents');
  assertCents(downPaymentCents, 'downPaymentCents');
  if (finalPriceCents <= 0) {
    throw Errors.validation({ finalPriceCents: 'السعر النهائي يجب أن يكون أكبر من صفر.' });
  }
  if (downPaymentCents >= finalPriceCents) {
    throw Errors.validation({
      downPaymentCents: 'الدفعة الأولى يجب أن تكون أقل من السعر النهائي ليبقى مبلغ للتقسيط.',
    });
  }
  if (
    !Number.isInteger(installmentsCount) ||
    installmentsCount < 1 ||
    installmentsCount > MAX_INSTALLMENTS
  ) {
    throw Errors.validation({
      installmentsCount: `عدد الأقساط يجب أن يكون بين 1 و${MAX_INSTALLMENTS}.`,
    });
  }
  if (!isValidIsoDate(startDate)) {
    throw Errors.validation({ startDate: 'تاريخ البداية غير صالح.' });
  }

  const remaining = finalPriceCents - downPaymentCents;
  if (remaining < installmentsCount) {
    throw Errors.validation({
      installmentsCount: 'عدد الأقساط أكبر من المبلغ المتبقي (قسط أقل من هللة).',
    });
  }

  const base = Math.floor(remaining / installmentsCount);
  const extra = remaining % installmentsCount;

  const schedule: ScheduledInstallment[] = [];
  if (downPaymentCents > 0) {
    schedule.push({
      sequence: 0,
      kind: 'down_payment',
      dueDate: startDate,
      amountCents: downPaymentCents,
    });
  }
  for (let k = 1; k <= installmentsCount; k += 1) {
    schedule.push({
      sequence: k,
      kind: 'regular',
      dueDate: addMonthsClamped(startDate, k),
      amountCents: base + (k <= extra ? 1 : 0),
    });
  }

  // صمام أمان: المجموع يطابق السعر النهائي بدقة تامة
  if (sumCents(schedule.map((i) => i.amountCents)) !== finalPriceCents) {
    throw new Error('invariant violated: schedule total != final price');
  }
  return schedule;
}
