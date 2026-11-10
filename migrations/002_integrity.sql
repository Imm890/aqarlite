-- 002: قواعد العمل الحرجة تُفرض في قاعدة البيانات نفسها وليس في الكود فقط.
-- رسائل الاستثناء تبدأ بـ AQ_ ليتعرّف عليها التطبيق ويحوّلها لرسالة عامة نظيفة.

-- ───────────── الوحدات: انتقالات الحالة المسموحة وقفل السعر ─────────────
CREATE FUNCTION units_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.company_id <> OLD.company_id THEN
    RAISE EXCEPTION 'AQ_IMMUTABLE_KEY' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.project, NEW.number, NEW.type, NEW.area_sqm, NEW.rooms, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.project, OLD.number, OLD.type, OLD.area_sqm, OLD.rooms, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'AQ_UNIT_FIELDS_IMMUTABLE' USING ERRCODE = 'check_violation';
  END IF;
  -- الانتقالات المسموحة فقط: available→reserved، reserved→available، reserved→sold
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'available' AND NEW.status = 'reserved') OR
       (OLD.status = 'reserved'  AND NEW.status IN ('available', 'sold'))
     ) THEN
    RAISE EXCEPTION 'AQ_UNIT_BAD_TRANSITION' USING ERRCODE = 'check_violation';
  END IF;
  -- لا تعديل لسعر وحدة محجوزة أو مُباعة
  IF NEW.price_cents <> OLD.price_cents AND NOT (OLD.status = 'available' AND NEW.status = 'available') THEN
    RAISE EXCEPTION 'AQ_UNIT_PRICE_LOCKED' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER units_guard BEFORE UPDATE ON units FOR EACH ROW EXECUTE FUNCTION units_guard();

-- ───────────── الحجوزات ─────────────
CREATE FUNCTION reservations_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.company_id, NEW.unit_id, NEW.client_id, NEW.rep_id, NEW.reserved_at, NEW.expires_at)
     IS DISTINCT FROM
     (OLD.id, OLD.company_id, OLD.unit_id, OLD.client_id, OLD.rep_id, OLD.reserved_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'AQ_RESERVATION_IMMUTABLE' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (OLD.status = 'active' AND NEW.status IN ('expired', 'converted')) THEN
    RAISE EXCEPTION 'AQ_RESERVATION_BAD_TRANSITION' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reservations_guard BEFORE UPDATE ON reservations FOR EACH ROW EXECUTE FUNCTION reservations_guard();

-- ───────────── العقود: بعد الاعتماد لا يُعدَّل شيء ─────────────
CREATE FUNCTION contracts_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'AQ_CONTRACT_IMMUTABLE' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.id, NEW.company_id, NEW.reservation_id, NEW.unit_id, NEW.client_id, NEW.rep_id,
      NEW.unit_price_cents, NEW.final_price_cents, NEW.down_payment_cents,
      NEW.installments_count, NEW.start_date, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.company_id, OLD.reservation_id, OLD.unit_id, OLD.client_id, OLD.rep_id,
      OLD.unit_price_cents, OLD.final_price_cents, OLD.down_payment_cents,
      OLD.installments_count, OLD.start_date, OLD.created_at) THEN
    RAISE EXCEPTION 'AQ_CONTRACT_IMMUTABLE' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contracts_guard BEFORE UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION contracts_guard();

-- ───────────── الأقساط: لا يتغير إلا المسدَّد والحالة، وتصاعدياً فقط ─────────────
CREATE FUNCTION installments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.company_id, NEW.contract_id, NEW.sequence, NEW.kind, NEW.due_date, NEW.amount_cents)
     IS DISTINCT FROM
     (OLD.id, OLD.company_id, OLD.contract_id, OLD.sequence, OLD.kind, OLD.due_date, OLD.amount_cents) THEN
    RAISE EXCEPTION 'AQ_INSTALLMENT_IMMUTABLE' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.paid_cents < OLD.paid_cents THEN
    RAISE EXCEPTION 'AQ_INSTALLMENT_PAID_DECREASE' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER installments_guard BEFORE UPDATE ON installments FOR EACH ROW EXECUTE FUNCTION installments_guard();

-- ───────────── سجلات غير قابلة للتعديل أو الحذف: الدفعات والتوزيعات وسجل التدقيق ─────────────
CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AQ_IMMUTABLE_RECORD' USING ERRCODE = 'check_violation';
END $$;

CREATE TRIGGER payments_immutable BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER payments_no_truncate BEFORE TRUNCATE ON payments FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
CREATE TRIGGER allocations_immutable BEFORE UPDATE OR DELETE ON payment_allocations FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER allocations_no_truncate BEFORE TRUNCATE ON payment_allocations FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

-- لا حذف نهائياً لبقية سجلات الأعمال
CREATE TRIGGER units_no_delete BEFORE DELETE ON units FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER clients_no_delete BEFORE DELETE ON clients FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER reservations_no_delete BEFORE DELETE ON reservations FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER contracts_no_delete BEFORE DELETE ON contracts FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER installments_no_delete BEFORE DELETE ON installments FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- ───────────── فحوص المجاميع المؤجَّلة (تُنفَّذ عند COMMIT) ─────────────

-- مجموع توزيعات الدفعة = مبلغ الدفعة تماماً
CREATE FUNCTION check_payment_total() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_payment_id uuid;
  v_amount bigint;
  v_allocated bigint;
BEGIN
  v_payment_id := CASE TG_TABLE_NAME WHEN 'payments' THEN NEW.id ELSE NEW.payment_id END;
  SELECT amount_cents INTO v_amount FROM payments WHERE id = v_payment_id;
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_allocated FROM payment_allocations WHERE payment_id = v_payment_id;
  IF v_amount IS DISTINCT FROM v_allocated THEN
    RAISE EXCEPTION 'AQ_PAYMENT_ALLOCATION_MISMATCH' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER payments_total_check AFTER INSERT ON payments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_payment_total();
CREATE CONSTRAINT TRIGGER allocations_total_check AFTER INSERT ON payment_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_payment_total();

-- المسدَّد في القسط = مجموع التوزيعات عليه
CREATE FUNCTION check_installment_paid() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_allocated bigint;
BEGIN
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_allocated FROM payment_allocations WHERE installment_id = NEW.id;
  IF NEW.paid_cents <> v_allocated THEN
    RAISE EXCEPTION 'AQ_INSTALLMENT_PAID_MISMATCH' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER installments_paid_check AFTER UPDATE OF paid_cents ON installments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_installment_paid();

-- العقد المعتمد: مجموع الأقساط (مع الدفعة الأولى) = السعر النهائي بدقة تامة
CREATE FUNCTION check_contract_schedule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_total bigint;
BEGIN
  IF NEW.status = 'approved' THEN
    SELECT COALESCE(SUM(amount_cents), 0) INTO v_total FROM installments WHERE contract_id = NEW.id;
    IF v_total <> NEW.final_price_cents THEN
      RAISE EXCEPTION 'AQ_SCHEDULE_TOTAL_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER contracts_schedule_check AFTER UPDATE OF status ON contracts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_contract_schedule();
