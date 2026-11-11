import { apiRoute, created, ok } from '@/server/http';
import { recordPayment, recordPaymentBody } from '@/server/services/payments';

export const dynamic = 'force-dynamic';

export const POST = apiRoute({
  permission: 'payment:create',
  body: recordPaymentBody,
  handler: async ({ ctx, body, ip }) => {
    const result = await recordPayment(ctx, body, ip);
    // 201 للدفعة الجديدة، 200 لإعادة إرسال نفس الطلب (لم تُنشأ دفعة جديدة)
    return result.replayed ? ok(result) : created(result);
  },
});
