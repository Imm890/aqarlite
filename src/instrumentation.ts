/**
 * مهمة خلفية تحرّر الحجوزات المنتهية (72 ساعة) كل دقيقة دون تدخل يدوي.
 * (وبجانبها كل مسار قراءة/كتابة يطبّق نفس القاعدة فوراً، فلا تعتمد صحة البيانات على هذه المهمة.)
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startExpiryJob } = await import('./server/jobs/expiry');
  startExpiryJob();
}
