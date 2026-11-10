import { Errors } from '@/lib/errors';
import { compareIsoDate, type IsoDate } from './dates';
import { MAX_AMOUNT_CENTS, sumCents } from './money';

/** الحالة المخزّنة في قاعدة البيانات. */
export type StoredInstallmentStatus = 'pending' | 'partial' | 'paid';
/** الحالة المعروضة: overdue تُشتق وقت القراءة ولا تُخزَّن (فلا تصبح قديمة). */
export type InstallmentStatus = StoredInstallmentStatus | 'overdue';

export interface InstallmentState {
  id: string;
  sequence: number;
  dueDate: IsoDate;
  amountCents: number;
  paidCents: number;
}

export interface Allocation {
  installmentId: string;
  /** المبلغ الموزَّع على هذا القسط من الدفعة الحالية */
  amountCents: number;
  newPaidCents: number;
  newStatus: Exclude<StoredInstallmentStatus, 'pending'>;
}

export function storedStatus(i: Pick<InstallmentState, 'amountCents' | 'paidCents'>): StoredInstallmentStatus {
  if (i.paidCents <= 0) return 'pending';
  return i.paidCents >= i.amountCents ? 'paid' : 'partial';
}

/** القسط متأخر إذا تجاوز تاريخ استحقاقه (بتوقيت الشركة) ولم يُسدَّد بالكامل. */
export function displayStatus(
  i: Pick<InstallmentState, 'amountCents' | 'paidCents' | 'dueDate'>,
  today: IsoDate,
): InstallmentStatus {
  const status = storedStatus(i);
  if (status !== 'paid' && compareIsoDate(i.dueDate, today) < 0) return 'overdue';
  return status;
}

export function remainingBalance(installments: readonly InstallmentState[]): number {
  return sumCents(installments.map((i) => i.amountCents - i.paidCents));
}

/**
 * يوزّع دفعة على أقدم الأقساط غير المسددة أولاً (حسب تاريخ الاستحقاق ثم التسلسل).
 * دالة نقية: لا تعدّل المدخلات، وترمي خطأ إن كان المبلغ غير صالح أو يتجاوز المتبقي.
 */
export function allocatePayment(
  installments: readonly InstallmentState[],
  amountCents: number,
): Allocation[] {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > MAX_AMOUNT_CENTS) {
    throw Errors.validation({ amountCents: 'مبلغ الدفعة يجب أن يكون عدداً صحيحاً موجباً (بالهللات).' });
  }
  if (amountCents > remainingBalance(installments)) {
    throw Errors.paymentExceedsBalance();
  }

  const ordered = [...installments].sort(
    (a, b) => compareIsoDate(a.dueDate, b.dueDate) || a.sequence - b.sequence,
  );

  const allocations: Allocation[] = [];
  let left = amountCents;
  for (const installment of ordered) {
    if (left === 0) break;
    const due = installment.amountCents - installment.paidCents;
    if (due <= 0) continue;
    const applied = Math.min(due, left);
    const newPaid = installment.paidCents + applied;
    allocations.push({
      installmentId: installment.id,
      amountCents: applied,
      newPaidCents: newPaid,
      newStatus: newPaid >= installment.amountCents ? 'paid' : 'partial',
    });
    left -= applied;
  }

  // صمام أمان: كل مبلغ الدفعة وُزّع
  if (left !== 0) throw new Error('invariant violated: payment not fully allocated');
  return allocations;
}
