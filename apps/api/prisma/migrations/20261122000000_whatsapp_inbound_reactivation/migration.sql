-- CreateTable
CREATE TABLE "whatsapp_inbound_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_message_id" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "message_type" VARCHAR(30) NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_inbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_inbound_messages_provider_message_id_key" ON "whatsapp_inbound_messages"("provider_message_id");

-- CreateIndex
CREATE INDEX "whatsapp_inbound_messages_phone_created_at_idx" ON "whatsapp_inbound_messages"("phone", "created_at");

-- CreateIndex
CREATE INDEX "notification_outbox_recipient_type_created_at_idx" ON "notification_outbox"("recipient", "type", "created_at");


-- Допустимые действия по входящему сообщению (D-32)
ALTER TABLE "whatsapp_inbound_messages" ADD CONSTRAINT whatsapp_inbound_messages_action_chk
  CHECK (action IN ('auto_reply', 'unsubscribe', 'throttled', 'ignored'));