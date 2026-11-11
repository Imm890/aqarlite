import { formatCents } from '@/domain/money';

export function money(cents: number, currency: string): string {
  return `${formatCents(cents)} ${currency}`;
}

export function dateTime(iso: string): string {
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export const UNIT_TYPE_LABEL: Record<string, string> = {
  apartment: 'شقة', villa: 'فيلا', townhouse: 'تاون هاوس', duplex: 'دوبلكس', office: 'مكتب', shop: 'محل',
};
export const UNIT_STATUS_LABEL: Record<string, string> = { available: 'متاحة', reserved: 'محجوزة', sold: 'مُباعة' };
export const INSTALLMENT_STATUS_LABEL: Record<string, string> = { pending: 'قادم', partial: 'جزئي', paid: 'مدفوع', overdue: 'متأخر' };
export const CONTRACT_STATUS_LABEL: Record<string, string> = { draft: 'مسودة', approved: 'معتمد', cancelled: 'ملغى' };
export const RESERVATION_STATUS_LABEL: Record<string, string> = { active: 'نشط', expired: 'منتهٍ', converted: 'تحوّل لعقد' };
export const ROLE_LABEL: Record<string, string> = { company_admin: 'مدير الشركة', sales_rep: 'مندوب مبيعات', accountant: 'محاسب' };
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  LOGIN_SUCCESS: 'دخول ناجح', LOGIN_FAILED: 'محاولة دخول فاشلة', LOGOUT: 'تسجيل خروج', UNIT_CREATED: 'إضافة وحدة',
  UNIT_PRICE_CHANGED: 'تغيير سعر وحدة', RESERVATION_CREATED: 'حجز وحدة', CONTRACT_CREATED: 'إنشاء مسودة عقد',
  CONTRACT_CANCELLED: 'إلغاء مسودة', CONTRACT_APPROVED: 'اعتماد عقد', PAYMENT_RECORDED: 'تسجيل دفعة',
};
