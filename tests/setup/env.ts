// يُنفَّذ داخل كل عامل اختبار قبل أي استيراد للتطبيق
const appPassword = process.env['APP_DB_PASSWORD'] ?? 'change-me-app-password';
const host = process.env['TEST_DB_HOST'] ?? '127.0.0.1:5432';

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: `postgres://aqarlite_app:${appPassword}@${host}/aqarlite_test`,
  APP_URL: 'http://localhost:3000',
  TRUST_PROXY_HOPS: '0',
  SESSION_TTL_HOURS: '12',
  SESSION_IDLE_MINUTES: '60',
  DB_POOL_MAX: '30',
});
