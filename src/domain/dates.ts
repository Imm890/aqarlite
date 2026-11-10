/**
 * تواريخ تقويمية بصيغة YYYY-MM-DD بحساب صحيح بحت — دون كائنات Date — لتفادي مشاكل
 * المناطق الزمنية والتوقيت الصيفي. (الاستثناء الوحيد: todayInTimeZone تستخدم Intl.)
 */
export type IsoDate = string;

export interface CalendarDate {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

export function parseIsoDate(value: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2200) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function formatIsoDate({ year, month, day }: CalendarDate): IsoDate {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${String(year).padStart(4, '0')}-${mm}-${dd}`;
}

export function isValidIsoDate(value: string): boolean {
  return parseIsoDate(value) !== null;
}

/**
 * يضيف عدداً من الأشهر إلى تاريخ البداية الأصلي مع "تثبيت" اليوم على آخر يوم في الشهر الهدف.
 *
 * المنطق الأوثق: يُحسب كل استحقاق من تاريخ البداية الأصلي مباشرة (وليس من الاستحقاق السابق)،
 * فلا يحدث انجراف: 31 يناير → 28/29 فبراير → 31 مارس (وليس 28 مارس) → 30 أبريل …
 */
export function addMonthsClamped(start: IsoDate, months: number): IsoDate {
  const parsed = parseIsoDate(start);
  if (!parsed) throw new RangeError(`invalid date: ${start}`);
  if (!Number.isInteger(months) || months < 0) throw new RangeError('months must be >= 0');
  const zeroBased = parsed.year * 12 + (parsed.month - 1) + months;
  const year = Math.floor(zeroBased / 12);
  const month = (zeroBased % 12) + 1;
  const day = Math.min(parsed.day, daysInMonth(year, month));
  return formatIsoDate({ year, month, day });
}

/** يقارن تاريخين: سالب إن كان a أقدم، صفر إن تساويا، موجب إن كان a أحدث. */
export function compareIsoDate(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0; // الصيغة الصفرية-المحشوّة تجعل المقارنة النصية صحيحة
}

/** تاريخ اليوم في منطقة زمنية معيّنة (مثل Asia/Riyadh) بصيغة YYYY-MM-DD. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): IsoDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
