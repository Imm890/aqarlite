-- 004: انتهاء صلاحية الحجز (72 ساعة) دون تدخل يدوي.
--
-- دالة واحدة هي مصدر المنطق، تُستدعى من:
--   • كل مسار يقرأ/يكتب حالة الوحدات (قائمة الوحدات، الحجز، العقود…) فالحالة صحيحة فور القراءة
--   • مهمة خلفية دورية في الخادم (src/instrumentation.ts)
-- هي SECURITY DEFINER لأنها زمنية بحتة وتطبّق نفس القاعدة على كل الشركات (لا تكشف ولا تغيّر
-- شيئاً غير ما كان سيتغير بمرور الوقت)، وتعمل بلا سياق شركة.
--
-- ترتيب الأقفال العام في النظام: الوحدة ← الحجز ← العقد ← الأقساط/الدفعات. هنا نقفل الوحدات
-- أولاً (بترتيب id) مع SKIP LOCKED: لا تنتظر ولا تسبّب deadlock مع معاملات حجز/اعتماد جارية.

CREATE INDEX reservations_expiry_global_idx ON reservations (expires_at) WHERE status = 'active';

CREATE FUNCTION expire_stale_reservations() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_count integer;
BEGIN
  WITH stale AS (
    SELECT r.id AS reservation_id, u.id AS unit_id
    FROM reservations r
    JOIN units u ON u.id = r.unit_id AND u.company_id = r.company_id
    WHERE r.status = 'active' AND r.expires_at <= now()
    ORDER BY u.id
    FOR UPDATE OF u SKIP LOCKED
  ), expired AS (
    UPDATE reservations r SET status = 'expired'
    FROM stale s WHERE r.id = s.reservation_id
    RETURNING r.id, r.unit_id
  ), freed AS (
    UPDATE units u SET status = 'available'
    FROM expired e WHERE u.id = e.unit_id AND u.status = 'reserved'
    RETURNING u.id
  ), cancelled AS (
    -- مسودة عقد حجزها انتهى لا يمكن اعتمادها
    UPDATE contracts c SET status = 'cancelled'
    FROM expired e WHERE c.reservation_id = e.id AND c.status = 'draft'
    RETURNING c.id
  )
  SELECT count(*) INTO v_count FROM expired;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION expire_stale_reservations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expire_stale_reservations() TO aqarlite_app;
