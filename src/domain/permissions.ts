/**
 * مصفوفة الأدوار والصلاحيات — مصدر الحقيقة الوحيد.
 * تُفرض في الخادم عبر authorize() في كل endpoint؛ إخفاء الأزرار في الواجهة تجميل فقط.
 * ما ليس مذكوراً صراحةً لدور ما فهو ممنوع عليه (deny by default).
 */
export const ROLES = ['company_admin', 'sales_rep', 'accountant'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = {
  'unit:read': ['company_admin', 'sales_rep', 'accountant'],
  'unit:create': ['company_admin'],
  'unit:update_price': ['company_admin'],

  'client:create': ['sales_rep'],
  'client:read_own': ['sales_rep'],
  'client:read_all': ['company_admin'],

  'reservation:create': ['sales_rep'],
  'reservation:read_own': ['sales_rep'],
  'reservation:read_all': ['company_admin'],

  'contract:create': ['sales_rep'],
  'contract:cancel_own_draft': ['sales_rep'],
  'contract:read_own': ['sales_rep'],
  'contract:read_all': ['company_admin', 'accountant'],
  'contract:approve': ['accountant'],

  'payment:create': ['accountant'],

  'audit:read': ['company_admin'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
