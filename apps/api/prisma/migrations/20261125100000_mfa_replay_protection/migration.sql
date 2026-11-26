-- Защита от повторного использования TOTP-кода (RFC 6238 §5.2): последний принятый временной шаг.
-- IF NOT EXISTS: в тестовой БД колонка уже создана черновиком этой же миграции под прежним именем.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfa_last_used_step" INTEGER;
