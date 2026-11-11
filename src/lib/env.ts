import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_SSL: z.enum(['true', 'false']).default('false'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),
  APP_URL: z.url().default('http://localhost:3000'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).max(1440).default(60),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** قراءة كسولة وصارمة للبيئة: تفشل مبكراً برسالة واضحة (دون طباعة القيم) عند نقص إعداد. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${names}`);
  }
  cached = parsed.data;
  return cached;
}

/** للاختبارات فقط */
export function resetEnvCache(): void {
  cached = undefined;
}

/** الكوكي Secure دائماً في production؛ في التطوير على http يمكن تعطيله صراحة. */
export function useSecureCookies(env: Env = getEnv()): boolean {
  if (env.NODE_ENV === 'production') return true;
  return env.COOKIE_SECURE === 'true';
}
