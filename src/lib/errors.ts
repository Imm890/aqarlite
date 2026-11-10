/**
 * أخطاء التطبيق. الرسالة (message) عربية عامة وآمنة للعرض للمستخدم؛
 * أي تفاصيل تقنية تُسجَّل في سجلات الخادم فقط ولا تُرسل للعميل.
 */
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'UNIT_NOT_AVAILABLE'
  | 'UNIT_LOCKED_FOR_PRICE'
  | 'RESERVATION_EXPIRED'
  | 'DISCOUNT_TOO_HIGH'
  | 'CONTRACT_NOT_DRAFT'
  | 'PAYMENT_EXCEEDS_BALANCE'
  | 'IDEMPOTENCY_MISMATCH'
  | 'INTERNAL';

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly fields: Readonly<Record<string, string>> | undefined;

  constructor(
    code: ErrorCode,
    status: number,
    message: string,
    fields?: Readonly<Record<string, string>>,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

export const Errors = {
  badRequest: (message = 'الطلب غير صالح.') => new AppError('BAD_REQUEST', 400, message),
  validation: (fields: Record<string, string>, message = 'تحقق من الحقول المُدخلة.') =>
    new AppError('VALIDATION', 422, message, fields),
  unauthenticated: () => new AppError('UNAUTHENTICATED', 401, 'يلزم تسجيل الدخول.'),
  forbidden: () => new AppError('FORBIDDEN', 403, 'ليست لديك صلاحية لتنفيذ هذا الإجراء.'),
  notFound: (what = 'العنصر المطلوب') => new AppError('NOT_FOUND', 404, `${what} غير موجود.`),
  conflict: (message: string) => new AppError('CONFLICT', 409, message),
  rateLimited: () =>
    new AppError('RATE_LIMITED', 429, 'محاولات كثيرة. يرجى المحاولة لاحقاً.'),
  unitNotAvailable: () =>
    new AppError('UNIT_NOT_AVAILABLE', 409, 'عذراً، هذه الوحدة لم تعد متاحة للحجز.'),
  unitLockedForPrice: () =>
    new AppError(
      'UNIT_LOCKED_FOR_PRICE',
      409,
      'لا يمكن تعديل سعر وحدة محجوزة أو مُباعة.',
    ),
  reservationExpired: () =>
    new AppError('RESERVATION_EXPIRED', 409, 'انتهت صلاحية الحجز أو لم يعد نشطاً.'),
  discountTooHigh: () =>
    new AppError(
      'DISCOUNT_TOO_HIGH',
      422,
      'الخصم يتجاوز الحد الأقصى المسموح (5%) أو أن السعر النهائي يفوق سعر الوحدة.',
      { finalPriceCents: 'السعر النهائي خارج النطاق المسموح.' },
    ),
  contractNotDraft: () =>
    new AppError('CONTRACT_NOT_DRAFT', 409, 'العقد ليس مسودة، ولا يمكن تعديله أو اعتماده مجدداً.'),
  paymentExceedsBalance: () =>
    new AppError(
      'PAYMENT_EXCEEDS_BALANCE',
      422,
      'مبلغ الدفعة يتجاوز المبلغ المتبقي من العقد.',
      { amountCents: 'المبلغ يتجاوز المتبقي من العقد.' },
    ),
  idempotencyMismatch: () =>
    new AppError(
      'IDEMPOTENCY_MISMATCH',
      422,
      'مفتاح منع التكرار استُخدم سابقاً مع بيانات مختلفة.',
    ),
  internal: () => new AppError('INTERNAL', 500, 'حدث خطأ غير متوقع. يرجى المحاولة لاحقاً.'),
} as const;
