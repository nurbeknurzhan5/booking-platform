-- Обезличивание клиента по запросу субъекта ПД (§22). Журналы аудита и согласий остаются append-only:
-- единственное допустимое изменение — стирание персональных данных, и только в транзакции, которая явно
-- включила режим `SELECT set_config('app.pii_erasure', 'on', true)` (ClientsService.anonymize).
--   audit_logs      — меняются только before/after (имя, телефон, заметки клиента);
--   client_consents — меняются только phone и ip (факт, тип, версия текста и время согласия сохраняются).
-- Удаление строк по-прежнему запрещено.
CREATE OR REPLACE FUNCTION forbid_modification_except_pii_erasure() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND current_setting('app.pii_erasure', true) = 'on' THEN
    IF TG_TABLE_NAME = 'audit_logs'
       AND (to_jsonb(NEW) - 'before' - 'after') = (to_jsonb(OLD) - 'before' - 'after') THEN
      RETURN NEW;
    END IF;
    IF TG_TABLE_NAME = 'client_consents'
       AND (to_jsonb(NEW) - 'phone' - 'ip') = (to_jsonb(OLD) - 'phone' - 'ip') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER audit_logs_append_only ON audit_logs;
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_modification_except_pii_erasure();

DROP TRIGGER client_consents_append_only ON client_consents;
CREATE TRIGGER client_consents_append_only
  BEFORE UPDATE OR DELETE ON client_consents
  FOR EACH ROW EXECUTE FUNCTION forbid_modification_except_pii_erasure();
