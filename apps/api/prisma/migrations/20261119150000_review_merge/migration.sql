-- Объединение дублей клиентов (§11) переназначает client_id отзыва; содержание отзыва (оценка, текст,
-- визит, организация) по-прежнему неизменяемо. Переназначение фиксируется в журнале аудита.
CREATE OR REPLACE FUNCTION reviews_immutable_content() RETURNS trigger AS $$
BEGIN
  IF NEW.rating IS DISTINCT FROM OLD.rating
     OR NEW.text IS DISTINCT FROM OLD.text
     OR NEW.appointment_id IS DISTINCT FROM OLD.appointment_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     -- имя автора меняется только при обезличивании персональных данных (§22)
     OR (NEW.author_name IS DISTINCT FROM OLD.author_name AND NEW.author_name <> 'Удалённый клиент')
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'review content is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
