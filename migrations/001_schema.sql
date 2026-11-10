-- 001: المخطط الأساسي.
-- المبالغ كلها BIGINT بالهللات (لا float ولا numeric للمال).
-- كل جدول أعمال يحمل company_id، والمفاتيح الأجنبية مركّبة (company_id, id) فلا يمكن
-- لقاعدة البيانات نفسها أن تربط سجلاً في شركة بسجل في شركة أخرى.

CREATE TABLE companies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  currency_code text NOT NULL DEFAULT 'SAR' CHECK (currency_code ~ '^[A-Z]{3}$'),
  timezone      text NOT NULL DEFAULT 'Asia/Riyadh',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies (id),
  email         text NOT NULL CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254),
  name          text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  role          text NOT NULL CHECK (role IN ('company_admin', 'sales_rep', 'accountant')),
  password_hash text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email),
  UNIQUE (company_id, id)
);

-- جلسات من جهة الخادم: الكوكي يحمل رمزاً عشوائياً، وهنا نخزّن SHA-256 له فقط.
CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash   bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  user_id      uuid NOT NULL,
  company_id   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  FOREIGN KEY (company_id, user_id) REFERENCES users (company_id, id)
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- محاولات الدخول (للحد من التخمين). لا تحتوي كلمات مرور أبداً.
CREATE TABLE login_attempts (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      text NOT NULL CHECK (char_length(email) <= 254),
  ip         text NOT NULL CHECK (char_length(ip) <= 64),
  success    boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_email_idx ON login_attempts (email, created_at);
CREATE INDEX login_attempts_ip_idx ON login_attempts (ip, created_at);

CREATE TABLE units (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id),
  project    text NOT NULL CHECK (char_length(btrim(project)) BETWEEN 1 AND 120),
  number     text NOT NULL CHECK (char_length(btrim(number)) BETWEEN 1 AND 40),
  type       text NOT NULL CHECK (type IN ('apartment', 'villa', 'townhouse', 'duplex', 'office', 'shop')),
  area_sqm   numeric(10, 2) NOT NULL CHECK (area_sqm > 0 AND area_sqm < 1000000),
  rooms      smallint NOT NULL CHECK (rooms BETWEEN 0 AND 30),
  price_cents bigint NOT NULL CHECK (price_cents BETWEEN 1 AND 100000000000),
  status     text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'sold')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, project, number),
  FOREIGN KEY (company_id, created_by) REFERENCES users (company_id, id)
);
CREATE INDEX units_list_status_idx ON units (company_id, status, price_cents, id);
CREATE INDEX units_list_price_idx ON units (company_id, price_cents, id);
CREATE INDEX units_list_area_idx ON units (company_id, area_sqm, id);

CREATE TABLE clients (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id),
  owner_id   uuid NOT NULL,  -- المندوب المسؤول عن العميل
  name       text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  phone      text NOT NULL CHECK (phone ~ '^\+?[0-9]{7,15}$'),
  notes      text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, id, owner_id),
  FOREIGN KEY (company_id, owner_id) REFERENCES users (company_id, id)
);
CREATE INDEX clients_owner_idx ON clients (company_id, owner_id, created_at DESC);

CREATE TABLE reservations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies (id),
  unit_id     uuid NOT NULL,
  client_id   uuid NOT NULL,
  rep_id      uuid NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'converted')),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  -- قاعدة الـ72 ساعة مفروضة في قاعدة البيانات نفسها
  CHECK (expires_at = reserved_at + interval '72 hours'),
  UNIQUE (company_id, id),
  UNIQUE (company_id, id, unit_id, client_id, rep_id),
  FOREIGN KEY (company_id, unit_id) REFERENCES units (company_id, id),
  -- المندوب لا يحجز إلا لعميله هو
  FOREIGN KEY (company_id, client_id, rep_id) REFERENCES clients (company_id, id, owner_id)
);
-- حجز نشط واحد فقط لكل وحدة: خط الدفاع الأخير ضد الحجز المتزامن
CREATE UNIQUE INDEX reservations_one_active_per_unit ON reservations (unit_id) WHERE status = 'active';
CREATE INDEX reservations_rep_idx ON reservations (company_id, rep_id, reserved_at DESC);
CREATE INDEX reservations_expiry_idx ON reservations (company_id, expires_at) WHERE status = 'active';

CREATE TABLE contracts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies (id),
  reservation_id      uuid NOT NULL,
  unit_id             uuid NOT NULL,
  client_id           uuid NOT NULL,
  rep_id              uuid NOT NULL,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),
  unit_price_cents    bigint NOT NULL CHECK (unit_price_cents BETWEEN 1 AND 100000000000),
  final_price_cents   bigint NOT NULL CHECK (final_price_cents BETWEEN 1 AND 100000000000),
  down_payment_cents  bigint NOT NULL CHECK (down_payment_cents >= 0),
  installments_count  integer NOT NULL CHECK (installments_count BETWEEN 1 AND 120),
  start_date          date NOT NULL,
  approved_by         uuid,
  approved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- خصم أقصاه 5% (حساب صحيح دقيق) ولا يفوق سعر الوحدة
  CHECK (final_price_cents <= unit_price_cents),
  CHECK (final_price_cents * 100 >= unit_price_cents * 95),
  CHECK (down_payment_cents < final_price_cents),
  CHECK ((status = 'approved') = (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, reservation_id, unit_id, client_id, rep_id)
    REFERENCES reservations (company_id, id, unit_id, client_id, rep_id),
  FOREIGN KEY (company_id, approved_by) REFERENCES users (company_id, id)
);
-- عقد حيّ واحد (مسودة/معتمد) لكل حجز، ولا تُباع الوحدة مرتين
CREATE UNIQUE INDEX contracts_one_live_per_reservation ON contracts (reservation_id) WHERE status IN ('draft', 'approved');
CREATE UNIQUE INDEX contracts_one_approved_per_unit ON contracts (unit_id) WHERE status = 'approved';
CREATE INDEX contracts_company_idx ON contracts (company_id, created_at DESC);
CREATE INDEX contracts_rep_idx ON contracts (company_id, rep_id, created_at DESC);

CREATE TABLE installments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies (id),
  contract_id  uuid NOT NULL,
  sequence     integer NOT NULL CHECK (sequence >= 0),
  kind         text NOT NULL CHECK (kind IN ('down_payment', 'regular')),
  due_date     date NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  paid_cents   bigint NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'paid')),
  CHECK (paid_cents <= amount_cents),
  CHECK ((kind = 'down_payment') = (sequence = 0)),
  CHECK (
    (status = 'pending' AND paid_cents = 0) OR
    (status = 'partial' AND paid_cents > 0 AND paid_cents < amount_cents) OR
    (status = 'paid' AND paid_cents = amount_cents)
  ),
  UNIQUE (contract_id, sequence),
  UNIQUE (company_id, id),
  UNIQUE (company_id, id, contract_id),
  FOREIGN KEY (company_id, contract_id) REFERENCES contracts (company_id, id)
);
CREATE INDEX installments_contract_idx ON installments (company_id, contract_id, due_date, sequence);

CREATE TABLE payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies (id),
  contract_id     uuid NOT NULL,
  amount_cents    bigint NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 100000000000),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  recorded_by     uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- نفس المفتاح داخل الشركة = نفس الدفعة (منع التكرار)
  UNIQUE (company_id, idempotency_key),
  UNIQUE (company_id, id),
  UNIQUE (company_id, id, contract_id),
  FOREIGN KEY (company_id, contract_id) REFERENCES contracts (company_id, id),
  FOREIGN KEY (company_id, recorded_by) REFERENCES users (company_id, id)
);
CREATE INDEX payments_contract_idx ON payments (company_id, contract_id, created_at);

CREATE TABLE payment_allocations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies (id),
  contract_id    uuid NOT NULL,
  payment_id     uuid NOT NULL,
  installment_id uuid NOT NULL,
  amount_cents   bigint NOT NULL CHECK (amount_cents > 0),
  UNIQUE (payment_id, installment_id),
  -- الدفعة والقسط يجب أن يتبعا العقد نفسه
  FOREIGN KEY (company_id, payment_id, contract_id) REFERENCES payments (company_id, id, contract_id),
  FOREIGN KEY (company_id, installment_id, contract_id) REFERENCES installments (company_id, id, contract_id)
);
CREATE INDEX payment_allocations_installment_idx ON payment_allocations (installment_id);

-- company_id قد يكون NULL لأحداث ما قبل المصادقة بلا مستخدم معروف (دخول فاشل ببريد غير موجود)؛
-- هذه لا يراها أي مدير شركة.
CREATE TABLE audit_logs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    uuid REFERENCES companies (id),
  actor_user_id uuid REFERENCES users (id),
  action        text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 64),
  entity_type   text CHECK (char_length(entity_type) <= 64),
  entity_id     uuid,
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip            text CHECK (char_length(ip) <= 64),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_company_idx ON audit_logs (company_id, id DESC);
CREATE INDEX audit_logs_action_idx ON audit_logs (company_id, action, id DESC);
