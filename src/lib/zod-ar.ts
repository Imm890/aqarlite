import { z } from 'zod';

/**
 * رسائل تحقق عربية مختصرة وواضحة للمستخدم (تظهر بجانب الحقل). الرسائل الخاصة بحقل معيّن
 * (المعرَّفة في المخطط عبر { error }) تتقدم على هذه الافتراضية.
 */
let configured = false;

export function configureZodArabic(): void {
  if (configured) return;
  configured = true;
  z.config({
    customError: (issue) => {
      switch (issue.code) {
        case 'invalid_type':
          return issue.input === undefined ? 'هذا الحقل مطلوب.' : 'قيمة غير صالحة.';
        case 'too_small':
          return issue.origin === 'string'
            ? `يجب ألا يقل عن ${String(issue.minimum)} أحرف.`
            : 'القيمة أقل من الحد المسموح.';
        case 'too_big':
          return issue.origin === 'string'
            ? `يجب ألا يزيد عن ${String(issue.maximum)} حرفاً.`
            : 'القيمة أكبر من الحد المسموح.';
        case 'invalid_format':
          return 'الصيغة غير صحيحة.';
        case 'invalid_value':
          return 'قيمة غير مسموحة.';
        case 'unrecognized_keys':
          return 'حقل غير مسموح.';
        case 'not_multiple_of':
          return 'قيمة غير صالحة.';
        default:
          return 'قيمة غير صالحة.';
      }
    },
  });
}
