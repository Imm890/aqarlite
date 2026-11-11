import type { AppError} from './errors';
import { Errors } from './errors';

interface PgErrorLike {
  code?: unknown;
  message?: unknown;
  constraint?: unknown;
}

function asPgError(error: unknown): PgErrorLike | null {
  return error && typeof error === 'object' ? (error as PgErrorLike) : null;
}

/**
 * يحوّل أخطاء قيود قاعدة البيانات (خط الدفاع الأخير) إلى أخطاء تطبيق عامة وآمنة.
 * يرجع null إن لم يكن الخطأ معروفاً (فيُعامل كخطأ داخلي 500 ويُسجَّل في الخادم).
 */
export function mapDbError(error: unknown): AppError | null {
  const pg = asPgError(error);
  if (!pg || typeof pg.code !== 'string') return null;
  const message = typeof pg.message === 'string' ? pg.message : '';
  const constraint = typeof pg.constraint === 'string' ? pg.constraint : '';

  if (pg.code === '23505') {
    switch (constraint) {
      case 'reservations_one_active_per_unit':
        return Errors.unitNotAvailable();
      case 'units_company_id_project_number_key':
        return Errors.validation({ number: 'رقم الوحدة مستخدم مسبقاً في هذا المشروع.' });
      case 'payments_company_id_idempotency_key_key':
        return Errors.idempotencyMismatch();
      case 'contracts_one_live_per_reservation':
        return Errors.conflict('يوجد عقد قائم لهذا الحجز بالفعل.');
      case 'contracts_one_approved_per_unit':
        return Errors.conflict('هذه الوحدة لها عقد معتمد بالفعل.');
      default:
        return Errors.conflict('تعذّر تنفيذ العملية بسبب تعارض مع بيانات موجودة.');
    }
  }
  if (pg.code === '23514' && message.startsWith('AQ_')) {
    if (message === 'AQ_UNIT_PRICE_LOCKED') return Errors.unitLockedForPrice();
    return Errors.conflict('العملية غير مسموحة في الحالة الحالية للسجل.');
  }
  if (pg.code === '23514') return Errors.badRequest('إحدى القيم المُدخلة خارج النطاق المسموح.');
  if (pg.code === '23503') return Errors.badRequest('إحدى القيم المرتبطة غير صالحة.');
  return null;
}
