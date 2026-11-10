import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// اختبارات الوحدة: منطق نقي بلا قاعدة بيانات
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
