import { existsSync } from 'node:fs';

/** يحمّل ملف .env إن وُجد (للسكربتات فقط؛ Next.js يحمّله بنفسه). لا يطغى على متغيرات البيئة الموجودة. */
export function loadDotEnv(path = '.env'): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
