-- AlterTable
ALTER TABLE "booking_settings" ADD COLUMN     "schedule_mode" VARCHAR(10) NOT NULL DEFAULT 'weekly';

-- AlterTable
ALTER TABLE "resources" ADD COLUMN     "is_public" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "photo_asset_id" UUID;

-- CreateTable
CREATE TABLE "staff_shifts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "break_start" INTEGER,
    "break_end" INTEGER,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_shifts_branch_id_date_idx" ON "staff_shifts"("branch_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "staff_shifts_resource_id_date_key" ON "staff_shifts"("resource_id", "date");

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_organization_id_photo_asset_id_fkey" FOREIGN KEY ("organization_id", "photo_asset_id") REFERENCES "media_assets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_organization_id_branch_id_resource_id_fkey" FOREIGN KEY ("organization_id", "branch_id", "resource_id") REFERENCES "resources"("organization_id", "branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Режим графика и корректность смен (задача 21)
ALTER TABLE "booking_settings" ADD CONSTRAINT booking_settings_schedule_mode_chk CHECK (schedule_mode IN ('weekly', 'shifts'));
ALTER TABLE "staff_shifts" ADD CONSTRAINT staff_shifts_time_chk
  CHECK (start_minute >= 0 AND end_minute <= 1440 AND end_minute > start_minute);
ALTER TABLE "staff_shifts" ADD CONSTRAINT staff_shifts_break_chk
  CHECK ((break_start IS NULL AND break_end IS NULL)
      OR (break_start IS NOT NULL AND break_end IS NOT NULL AND break_start >= start_minute AND break_end <= end_minute AND break_end > break_start));
