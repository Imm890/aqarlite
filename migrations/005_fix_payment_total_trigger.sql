-- 005: إصلاح محفّز فحص مجموع توزيع الدفعة.
-- الخطأ: التعبير CASE على TG_TABLE_NAME كان يُقيِّم NEW.payment_id حتى على جدول payments
-- (الذي لا يملك هذا الحقل) فيفشل كل إدراج دفعة. الحل: دالتان مستقلتان لكل جدول.

DROP TRIGGER payments_total_check ON payments;
DROP TRIGGER allocations_total_check ON payment_allocations;
DROP FUNCTION check_payment_total();

CREATE FUNCTION assert_payment_fully_allocated(p_payment_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_amount bigint;
  v_allocated bigint;
BEGIN
  SELECT amount_cents INTO v_amount FROM payments WHERE id = p_payment_id;
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_allocated FROM payment_allocations WHERE payment_id = p_payment_id;
  IF v_amount IS DISTINCT FROM v_allocated THEN
    RAISE EXCEPTION 'AQ_PAYMENT_ALLOCATION_MISMATCH' USING ERRCODE = 'check_violation';
  END IF;
END $$;

CREATE FUNCTION check_payment_total_on_payment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_payment_fully_allocated(NEW.id);
  RETURN NULL;
END $$;

CREATE FUNCTION check_payment_total_on_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_payment_fully_allocated(NEW.payment_id);
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER payments_total_check AFTER INSERT ON payments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_payment_total_on_payment();
CREATE CONSTRAINT TRIGGER allocations_total_check AFTER INSERT ON payment_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_payment_total_on_allocation();
