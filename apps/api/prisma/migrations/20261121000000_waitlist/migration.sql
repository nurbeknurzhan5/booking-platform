-- AlterTable
ALTER TABLE "booking_settings" ADD COLUMN     "waitlist_after_expiry" VARCHAR(20) NOT NULL DEFAULT 'offer_next',
ADD COLUMN     "waitlist_priority" VARCHAR(20) NOT NULL DEFAULT 'fifo';

-- AlterTable
ALTER TABLE "waitlist_entries" ADD COLUMN     "appointment_id" UUID,
ADD COLUMN     "cancelled_at" TIMESTAMPTZ(3),
ADD COLUMN     "locale" VARCHAR(2) NOT NULL DEFAULT 'ru',
ADD COLUMN     "source" VARCHAR(20) NOT NULL DEFAULT 'online',
ADD COLUMN     "token_hash" VARCHAR(64);

-- CreateTable
CREATE TABLE "waitlist_releases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "source_appointment_id" UUID,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "resource_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "round" INTEGER NOT NULL DEFAULT 0,
    "round_expires_at" TIMESTAMPTZ(3),
    "offered_entry_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "closed_reason" VARCHAR(40),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "waitlist_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist_offers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "release_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "responded_at" TIMESTAMPTZ(3),
    "appointment_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "waitlist_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "waitlist_releases_status_round_expires_at_idx" ON "waitlist_releases"("status", "round_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_releases_organization_id_id_key" ON "waitlist_releases"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_offers_token_hash_key" ON "waitlist_offers"("token_hash");

-- CreateIndex
CREATE INDEX "waitlist_offers_release_id_status_idx" ON "waitlist_offers"("release_id", "status");

-- CreateIndex
CREATE INDEX "waitlist_offers_entry_id_status_idx" ON "waitlist_offers"("entry_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_entries_token_hash_key" ON "waitlist_entries"("token_hash");

-- CreateIndex
CREATE INDEX "waitlist_entries_client_id_status_idx" ON "waitlist_entries"("client_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_entries_organization_id_id_key" ON "waitlist_entries"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "waitlist_releases" ADD CONSTRAINT "waitlist_releases_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_offers" ADD CONSTRAINT "waitlist_offers_organization_id_release_id_fkey" FOREIGN KEY ("organization_id", "release_id") REFERENCES "waitlist_releases"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_offers" ADD CONSTRAINT "waitlist_offers_organization_id_entry_id_fkey" FOREIGN KEY ("organization_id", "entry_id") REFERENCES "waitlist_entries"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Ограничения листа ожидания (§9)
ALTER TABLE "waitlist_entries" ADD CONSTRAINT waitlist_entries_status_chk
  CHECK (status IN ('pending_otp', 'waiting', 'offered', 'booked', 'cancelled', 'expired'));
ALTER TABLE "waitlist_entries" ADD CONSTRAINT waitlist_entries_dates_chk CHECK (date_to >= date_from);
ALTER TABLE "waitlist_entries" ADD CONSTRAINT waitlist_entries_services_chk CHECK (cardinality(service_ids) BETWEEN 1 AND 5);
ALTER TABLE "waitlist_releases" ADD CONSTRAINT waitlist_releases_status_chk CHECK (status IN ('pending', 'offering', 'booked', 'closed'));
ALTER TABLE "waitlist_releases" ADD CONSTRAINT waitlist_releases_time_chk CHECK (end_at > start_at);
ALTER TABLE "waitlist_offers" ADD CONSTRAINT waitlist_offers_status_chk
  CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled', 'lost'));
ALTER TABLE "waitlist_offers" ADD CONSTRAINT waitlist_offers_time_chk CHECK (end_at > start_at);
ALTER TABLE "booking_settings" ADD CONSTRAINT booking_settings_waitlist_chk
  CHECK (waitlist_priority IN ('fifo', 'priority') AND waitlist_after_expiry IN ('offer_next', 'release')
         AND waitlist_offer_minutes > 0 AND waitlist_recipients > 0);

-- Освободившееся время получает не больше одного клиента из листа ожидания (вторая линия защиты после EXCLUDE).
CREATE UNIQUE INDEX waitlist_offers_one_accepted ON "waitlist_offers" (release_id) WHERE status = 'accepted';
-- У заявки не больше одного действующего предложения.
CREATE UNIQUE INDEX waitlist_offers_one_pending_per_entry ON "waitlist_offers" (entry_id) WHERE status = 'pending';