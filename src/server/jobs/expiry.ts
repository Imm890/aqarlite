import { withoutTenant } from '@/lib/db';
import { logger } from '@/lib/logger';

const INTERVAL_MS = 60_000;
let timer: NodeJS.Timeout | undefined;

export async function runExpiryOnce(): Promise<number> {
  const result = await withoutTenant((db) => db.query<{ expire_stale_reservations: number }>('SELECT expire_stale_reservations()'));
  return result.rows[0]?.expire_stale_reservations ?? 0;
}

export function startExpiryJob(): void {
  if (timer) return;
  const tick = (): void => {
    runExpiryOnce()
      .then((n) => {
        if (n > 0) logger.info('expired reservations released', { count: n });
      })
      .catch((error: unknown) => logger.error('expiry job failed', { error }));
  };
  timer = setInterval(tick, INTERVAL_MS);
  timer.unref();
  tick();
}
