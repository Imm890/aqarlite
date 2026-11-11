import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// اختبارات التكامل: تحتاج PostgreSQL حقيقياً (TEST_DATABASE_ADMIN_URL)
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['tests/setup/global.ts'],
    setupFiles: ['tests/setup/env.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
