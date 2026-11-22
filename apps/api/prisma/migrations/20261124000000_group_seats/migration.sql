-- Групповая бронь мест (D-41): позиция записи может занимать несколько одинаковых мест (ПК, консоли).
ALTER TABLE "appointment_items" ADD COLUMN "seats" SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_seats_check" CHECK ("seats" BETWEEN 1 AND 20);
