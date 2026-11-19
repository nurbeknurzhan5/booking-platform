-- ============================================================
-- Ограничения целостности, которые Prisma не выражает в схеме.
-- ============================================================

-- 1. ЗАЩИТА ОТ ДВОЙНОГО БРОНИРОВАНИЯ (ТЗ §6.1, §8.4, критерий приёмки 9)
-- Две активные занятости одного ресурса не могут пересекаться по времени.
ALTER TABLE appointment_resources
  ADD CONSTRAINT appointment_resources_time_chk CHECK (end_at > start_at);
ALTER TABLE appointment_resources
  ADD CONSTRAINT appointment_resources_no_overlap
  EXCLUDE USING gist (resource_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&)
  WHERE (is_active);

-- 2. Одна активная карточка клиента на номер в организации (§11).
ALTER TABLE clients
  ADD CONSTRAINT clients_active_phone_unique
  EXCLUDE USING btree (organization_id WITH =, phone WITH =)
  WHERE (merged_into_id IS NULL);

-- 3. CHECK-ограничения
ALTER TABLE appointments ADD CONSTRAINT appointments_time_chk CHECK (end_at > start_at);
ALTER TABLE appointments ADD CONSTRAINT appointments_price_chk
  CHECK (base_total >= 0 AND sale_discount_total >= 0 AND promo_discount_total >= 0 AND total_price >= 0);
ALTER TABLE appointment_items ADD CONSTRAINT appointment_items_time_chk CHECK (end_at > start_at);
ALTER TABLE appointment_items ADD CONSTRAINT appointment_items_price_chk
  CHECK (base_price >= 0 AND final_price >= 0 AND sale_discount >= 0 AND promo_discount >= 0);
ALTER TABLE services ADD CONSTRAINT services_values_chk
  CHECK (price >= 0 AND duration_minutes > 0 AND buffer_before_minutes >= 0 AND buffer_after_minutes >= 0);
ALTER TABLE branch_services ADD CONSTRAINT branch_services_price_chk CHECK (price_override IS NULL OR price_override >= 0);
ALTER TABLE specialist_services ADD CONSTRAINT specialist_services_price_chk CHECK (price_override IS NULL OR price_override >= 0);
ALTER TABLE working_hours ADD CONSTRAINT working_hours_chk
  CHECK (weekday BETWEEN 1 AND 7 AND start_minute >= 0 AND end_minute <= 1440 AND end_minute > start_minute);
ALTER TABLE breaks ADD CONSTRAINT breaks_chk
  CHECK (weekday BETWEEN 1 AND 7 AND start_minute >= 0 AND end_minute <= 1440 AND end_minute > start_minute);
ALTER TABLE schedule_exceptions ADD CONSTRAINT schedule_exceptions_chk
  CHECK (date_to >= date_from AND kind IN ('closed', 'custom_hours'));
ALTER TABLE reviews ADD CONSTRAINT reviews_rating_chk CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE promotions ADD CONSTRAINT promotions_discount_chk
  CHECK (discount_value > 0 AND (discount_type <> 'percent' OR discount_value <= 100));
ALTER TABLE promotions ADD CONSTRAINT promotions_code_chk CHECK (kind <> 'promo_code' OR code IS NOT NULL);
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_period_chk CHECK (ends_at > starts_at AND grace_days >= 0 AND max_branches >= 1);
ALTER TABLE subscription_payments ADD CONSTRAINT subscription_payments_amount_chk CHECK (amount >= 0);
ALTER TABLE booking_settings ADD CONSTRAINT booking_settings_chk
  CHECK (slot_interval_minutes > 0 AND hold_minutes > 0 AND max_horizon_days > 0 AND max_active_appointments_per_client > 0);
ALTER TABLE users ADD CONSTRAINT users_identity_chk CHECK (email IS NOT NULL OR phone IS NOT NULL);

-- 4. ОТЗЫВЫ: оценка и текст неизменяемы (§14 «владелец не может незаметно изменять отзывы»)
CREATE OR REPLACE FUNCTION reviews_immutable_content() RETURNS trigger AS $$
BEGIN
  IF NEW.rating IS DISTINCT FROM OLD.rating
     OR NEW.text IS DISTINCT FROM OLD.text
     OR NEW.appointment_id IS DISTINCT FROM OLD.appointment_id
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'review content is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reviews_immutable_content_trg
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION reviews_immutable_content();

-- 5. APPEND-ONLY журналы: история платежей, подписок, аудит, статусы записей (§2.3, §8.2, §22)
CREATE OR REPLACE FUNCTION forbid_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER subscription_payments_append_only
  BEFORE UPDATE OR DELETE ON subscription_payments
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER subscription_history_append_only
  BEFORE UPDATE OR DELETE ON subscription_history
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER appointment_status_history_append_only
  BEFORE UPDATE OR DELETE ON appointment_status_history
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER appointment_reschedules_append_only
  BEFORE UPDATE OR DELETE ON appointment_reschedules
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER client_consents_append_only
  BEFORE UPDATE OR DELETE ON client_consents
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER page_publications_append_only
  BEFORE UPDATE OR DELETE ON page_publications
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();

-- 6. Служебные индексы
CREATE INDEX booking_holds_active_idx ON booking_holds (expires_at) WHERE released_at IS NULL;
CREATE INDEX notification_outbox_due_idx ON notification_outbox (next_attempt_at) WHERE status IN ('pending', 'failed');
CREATE INDEX jobs_due_idx ON jobs (queue, run_at) WHERE status IN ('pending', 'failed');
CREATE INDEX appointment_resources_active_idx ON appointment_resources (resource_id, start_at, end_at) WHERE is_active;

-- 7. Счётчики rate limit не требуют WAL (теряются при сбое — допустимо)
ALTER TABLE rate_limit_buckets SET UNLOGGED;
