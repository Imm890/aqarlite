import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id (الخوارزمية الافتراضية في هذه المكتبة) بمعاملات توصية OWASP:
 * ذاكرة 19 MiB، 2 تكرار، توازي 1. كل تجزئة تحمل ملحاً عشوائياً خاصاً بها.
 */
const PARAMS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, PARAMS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false; // تجزئة تالفة أو غير مدعومة = فشل تحقق، لا استثناء مكشوف
  }
}

let dummyHashPromise: Promise<string> | undefined;

/**
 * تجزئة وهمية للمقارنة عند عدم وجود المستخدم، فيستغرق الدخول بريداً غير موجود نفس زمن
 * بريد موجود تقريباً (منع كشف وجود البريد عبر زمن الاستجابة).
 */
export function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('dummy-password-for-timing-equalization');
  return dummyHashPromise;
}
