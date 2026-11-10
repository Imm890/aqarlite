-- 003: الأمان في طبقة قاعدة البيانات (دفاع في العمق خلف فحوص التطبيق).
--
-- 1) التطبيق يتصل بدور aqarlite_app: ليس superuser، ليس مالك الجداول، بلا BYPASSRLS،
--    وله أقل الصلاحيات اللازمة (لا DELETE في أي مكان، ولا UPDATE على الدفعات/التدقيق).
-- 2) Row Level Security على كل جداول الأعمال: لا يرى الدور إلا صفوف الشركة المضبوطة في
--    app.company_id داخل المعاملة الحالية. إن لم تُضبط → لا صفوف (يفشل بإغلاق آمن).
-- 3) جداول المصادقة (sessions) لا صلاحية مباشرة عليها؛ تُستعمل فقط عبر دوال SECURITY DEFINER
--    ضيقة ومُعلَّمة بـ search_path ثابت، وهي المسار الوحيد الذي يعمل قبل معرفة الشركة.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aqarlite_app') THEN
    CREATE ROLE aqarlite_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO aqarlite_app', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO aqarlite_app;

-- الشركة الحالية من إعداد المعاملة (يضبطه التطبيق بـ set_config(..., true) من الجلسة فقط)
CREATE FUNCTION app_tenant() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.company_id', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION app_tenant() TO aqarlite_app;

-- ───────────── RLS ─────────────
ALTER TABLE companies           ENABLE ROW LEVEL SECURITY;
ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE units               ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients             ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE installments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs          ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON companies FOR SELECT TO aqarlite_app USING (id = app_tenant());
CREATE POLICY tenant_isolation ON users     FOR SELECT TO aqarlite_app USING (company_id = app_tenant());

CREATE POLICY tenant_isolation ON units               TO aqarlite_app USING (company_id = app_tenant()) WITH CHECK (company_id = app_tenant());
CREATE POLICY tenant_isolation ON clients             TO aqarlite_app USING (company_id = app_tenant()) WITH CHECK (company_id = app_tenant());
CREATE POLICY tenant_isolation ON reservations        TO aqarlite_app USING (company_id = app_tenant()) WITH CHECK (company_id = app_tenant());
CREATE POLICY tenant_isolation ON contracts           TO aqarlite_app USING (company_id = app_tenant()) WITH CHECK (company_id = app_tenant());
CREATE POLICY tenant_isolation ON installments        TO aqarlite_app USING (company_id = app_tenant()) WITH CHECK (company_id = app_tenant());
CREATE POLICY tenant_isolation ON payments            TO aqarlite_app USING (company_id = app_tenant()) WITH CHECK (company_id = app_tenant());
CREATE POLICY tenant_isolation ON payment_allocations TO aqarlite_app USING (company_id = app_tenant()) WITH CHECK (company_id = app_tenant());

-- سجل التدقيق: القراءة لشركة المستخدم فقط؛ الإدراج لشركته أو لحدث بلا شركة (دخول فاشل مجهول)
CREATE POLICY audit_read   ON audit_logs FOR SELECT TO aqarlite_app USING (company_id = app_tenant());
CREATE POLICY audit_insert ON audit_logs FOR INSERT TO aqarlite_app
  WITH CHECK (company_id = app_tenant() OR company_id IS NULL);

-- ───────────── الصلاحيات (أقل ما يلزم) ─────────────
GRANT SELECT ON companies TO aqarlite_app;
-- لا يُمنح password_hash؛ التحقق من الدخول عبر auth_find_login فقط
GRANT SELECT (id, company_id, email, name, role, is_active, created_at) ON users TO aqarlite_app;

GRANT SELECT, INSERT, UPDATE ON units        TO aqarlite_app;
GRANT SELECT, INSERT         ON clients      TO aqarlite_app;
GRANT SELECT, INSERT, UPDATE ON reservations TO aqarlite_app;
GRANT SELECT, INSERT, UPDATE ON contracts    TO aqarlite_app;
GRANT SELECT, INSERT, UPDATE ON installments TO aqarlite_app;
GRANT SELECT, INSERT         ON payments            TO aqarlite_app;
GRANT SELECT, INSERT         ON payment_allocations TO aqarlite_app;
GRANT SELECT, INSERT         ON audit_logs   TO aqarlite_app;
GRANT SELECT, INSERT, DELETE ON login_attempts TO aqarlite_app;
-- sessions: لا شيء مباشراً

-- ───────────── دوال المصادقة (SECURITY DEFINER) ─────────────
CREATE FUNCTION auth_find_login(p_email text)
RETURNS TABLE (user_id uuid, company_id uuid, role text, name text, password_hash text, is_active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.company_id, u.role, u.name, u.password_hash, u.is_active
  FROM users u WHERE u.email = lower(btrim(p_email)) LIMIT 1
$$;

CREATE FUNCTION auth_create_session(p_user_id uuid, p_token_hash bytea, p_ttl_seconds integer)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_company uuid;
  v_id uuid;
BEGIN
  SELECT u.company_id INTO v_company FROM users u WHERE u.id = p_user_id AND u.is_active;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'AQ_NO_SUCH_USER';
  END IF;
  DELETE FROM sessions WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '7 days';
  INSERT INTO sessions (token_hash, user_id, company_id, expires_at)
  VALUES (p_token_hash, p_user_id, v_company, now() + make_interval(secs => p_ttl_seconds))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- يتحقق من الجلسة (غير ملغاة، غير منتهية، ضمن مهلة الخمول، المستخدم فعّال) ويحدّث آخر نشاط
CREATE FUNCTION auth_resolve_session(p_token_hash bytea, p_idle_seconds integer)
RETURNS TABLE (session_id uuid, user_id uuid, company_id uuid, role text, name text, email text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  UPDATE sessions s SET last_seen_at = now()
  FROM users u
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND s.last_seen_at > now() - make_interval(secs => p_idle_seconds)
    AND u.id = s.user_id AND u.company_id = s.company_id AND u.is_active
  RETURNING s.id, u.id, u.company_id, u.role, u.name, u.email;
END $$;

-- تسجيل الخروج: إبطال فعلي في الخادم
CREATE FUNCTION auth_revoke_session(p_token_hash bytea)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE sessions SET revoked_at = now() WHERE token_hash = p_token_hash AND revoked_at IS NULL
$$;

REVOKE ALL ON FUNCTION auth_find_login(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_create_session(uuid, bytea, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_resolve_session(bytea, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_revoke_session(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_login(text) TO aqarlite_app;
GRANT EXECUTE ON FUNCTION auth_create_session(uuid, bytea, integer) TO aqarlite_app;
GRANT EXECUTE ON FUNCTION auth_resolve_session(bytea, integer) TO aqarlite_app;
GRANT EXECUTE ON FUNCTION auth_revoke_session(bytea) TO aqarlite_app;
